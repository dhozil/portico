/**
 * Portico live-flow driver.
 *
 * Runs the real lifecycle against a deployed Portico contract: post -> vouch ->
 * apply -> screen -> hire -> deliver -> adjudicate -> appeal -> reply -> resolve
 * -> settle. Every step is a real GenLayer transaction with real web reads and
 * real model calls, so this is the slowest possible smoke test and the most
 * convincing one.
 *
 * Usage (from frontend/):
 *   CONTRACT=0x... EMPLOYER_PK=0x... REFERRER_PK=0x... APPLICANT_PK=0x... \
 *     node scripts/live-demo.mjs post
 *   ... then: refer | apply | screen | hire | deliver | adjudicate | appeal |
 *             reply | resolve | settle | show
 *
 * State is kept in /tmp/portico-live.json so a stage can be re-run or resumed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createAccount, createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

const CONTRACT = process.env.CONTRACT
const STATE_PATH = process.env.STATE_PATH || '/tmp/portico-live.json'
const STAGE = process.argv[2] || 'show'
const SCENARIO = process.env.SCENARIO || 'sdk'

/**
 * Two complete dossiers. `sdk` is the original PASS run; `ledger` is a second
 * role with a deliberately partial deliverable, so the board holds one of each
 * and a partial payout is demonstrated with real consensus.
 */
const SCENARIOS = {
  sdk: {
    title: 'SDK documentation engineer — quickstart README',
    role: 'Turn the GenLayer JS SDK into a quickstart a new developer can follow without asking questions.',
    requirements:
      'TypeScript or JavaScript developer-docs experience. Can read a JS SDK and write a correct installation and usage guide. Evidence of published developer documentation.',
    criteria:
      'A public README that (1) shows how to install the JavaScript SDK with npm, (2) shows how to create a client with createClient, (3) shows how to read contract state with readContract.',
    hint: 'A link to a rendered README or a raw markdown file a reviewer can open.',
    minScore: 500,
    escrow: 10n * GEN,
    applyDays: 7,
    deliverDays: 14,
    appealDays: 1,
    referralNote:
      'I worked with this person on a developer-tooling team. They shipped the docs a whole release ahead of schedule.',
    applicationSummary:
      'I write developer documentation for JavaScript tooling and have shipped quickstarts for two SDKs. I read the GenLayer JS source before writing the guide, so the examples match the shipped API.',
    skills: 'typescript, javascript, sdk docs, api reference, npm packaging',
    applicationEvidence:
      'https://github.com/genlayerlabs/genlayer-js\nhttps://raw.githubusercontent.com/genlayerlabs/genlayer-js/main/README.md',
    deliverySummary:
      'Shipped the quickstart README. It documents npm install, createClient, and readContract with runnable examples drawn from the SDK source.',
    deliveryEvidence: 'https://raw.githubusercontent.com/genlayerlabs/genlayer-js/main/README.md',
    appealStatement:
      'The readContract example references a contractAddress that is never defined, so a new developer cannot run it. The quickstart criterion is only partly met.',
    replyStatement:
      'The readContract example is illustrative, but the two criteria the brief names explicitly are both evidenced: npm install and createClient. The core deliverable is present and usable.',
  },
  ledger: {
    title: 'Reconciliation analyst — audit the Portico escrow ledger',
    role: 'Write the reconciliation query that proves every credited atto traces back to a funded escrow, and the runbook an operator follows when it does not.',
    requirements:
      'SQL fluency, comfort reading an event-sourced ledger, and the habit of writing the failure path before the happy path. Evidence of a published query, test or audit note.',
    criteria:
      'A public note that contains (1) a SQL query comparing escrow in against credits out per job, (2) a test asserting the query returns zero rows on a settled ledger, and (3) a runbook section stating what an operator does when the query returns rows.',
    hint: 'A public markdown file with the query, the test and the runbook.',
    minScore: 500,
    escrow: 6n * GEN,
    applyDays: 7,
    deliverDays: 14,
    appealDays: 1,
    referralNote:
      'I reviewed this analyst on a ledger migration. They would not sign off until the reconciliation query returned zero rows on a copy of production.',
    applicationSummary:
      'I reconcile event-sourced ledgers and write the failure path first. I read the Portico ledger model in the repo before writing the query, so the columns match the events the contract actually emits.',
    skills: 'sql, reconciliation, event sourcing, ledger audit, incident runbook',
    applicationEvidence:
      'https://raw.githubusercontent.com/dhozil/portico/main/docs/samples/reconciliation-runbook.md\nhttps://raw.githubusercontent.com/dhozil/portico/main/docs/architecture.md',
    deliverySummary:
      'Published the reconciliation note with the escrow-versus-credits query and the settled-ledger test. The runbook section is still a stub, so the failure path is not yet documented.',
    deliveryEvidence:
      'https://raw.githubusercontent.com/dhozil/portico/main/docs/samples/reconciliation-runbook.md',
    appealStatement:
      'The runbook section is a stub, so the note does not satisfy the third criterion. A partial payout is the correct reading.',
    replyStatement:
      'The query and the test are both published and both run. The third section is incomplete, which the note states plainly.',
  },
}

const S = SCENARIOS[SCENARIO]
if (!S) {
  console.error('Unknown SCENARIO ' + SCENARIO + ' (use sdk or ledger)')
  process.exit(1)
}

if (!CONTRACT) {
  console.error('Set CONTRACT to the deployed Portico address.')
  process.exit(1)
}

const STATUS_BY_NUMBER = {
  0: 'UNINITIALIZED',
  1: 'PENDING',
  2: 'PROPOSING',
  3: 'COMMITTING',
  4: 'REVEALING',
  5: 'ACCEPTED',
  6: 'UNDETERMINED',
  7: 'FINALIZED',
  8: 'CANCELED',
  12: 'VALIDATORS_TIMEOUT',
  13: 'LEADER_TIMEOUT',
}

const GEN = 10n ** 18n

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function clean(payload) {
  return String(payload ?? '').trim().replace(/^"+|"+$/g, '').trim()
}

function decodePayload(payload) {
  if (typeof payload === 'string') return payload
  if (!payload) return ''
  if (typeof payload.readable === 'string') return payload.readable
  if (Array.isArray(payload.raw)) {
    try {
      return new TextDecoder().decode(new Uint8Array(payload.raw))
    } catch {
      return ''
    }
  }
  return JSON.stringify(payload)
}

function clients() {
  const out = {}
  for (const role of ['EMPLOYER', 'REFERRER', 'APPLICANT']) {
    const pk = process.env[role + '_PK']
    if (!pk) throw new Error('Missing ' + role + '_PK')
    out[role] = createClient({ chain: studionet, account: createAccount(pk) })
  }
  return out
}

async function submit(client, functionName, args, value = 0n) {
  const hash = await client.writeContract({ address: CONTRACT, functionName, args, value })
  console.log('  submitted', functionName, hash)
  let last = ''
  for (let attempt = 0; attempt < 200; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    let tx
    try {
      tx = await client.getTransaction({ hash })
    } catch {
      continue
    }
    const name = tx.statusName ?? STATUS_BY_NUMBER[tx.status] ?? ''
    if (name && name !== last) {
      last = name
      console.log('  status', name)
    }
    if (['FINALIZED', 'UNDETERMINED', 'CANCELED', 'VALIDATORS_TIMEOUT', 'LEADER_TIMEOUT'].includes(name)) {
      const leader = tx.consensus_data?.leader_receipt?.[0]
      const execution = leader?.execution_result ?? 'UNKNOWN'
      const payload = decodePayload(leader?.result?.payload)
      console.log('  execution', execution, payload ? '· ' + payload.slice(0, 300) : '')
      return { hash, status: name, execution, payload }
    }
  }
  throw new Error(functionName + ' did not settle in time')
}

async function view(client, functionName, args = []) {
  return client.readContract({ address: CONTRACT, functionName, args })
}

async function main() {
  const state = loadState()
  const c = clients()
  const reader = c.EMPLOYER

  if (STAGE === 'post') {
    console.log('posting the role (' + SCENARIO + ' scenario)')
    const result = await submit(
      c.EMPLOYER,
      'post_job',
      [
        S.title,
        S.role,
        S.requirements,
        S.criteria,
        S.hint,
        'REFERRAL',
        S.minScore,
        7_000,
        2_700,
        50_000_000_000_000_000n,
        S.applyDays,
        S.deliverDays,
        S.appealDays,
      ],
      S.escrow,
    )
    state.job_id = clean(result.payload)
    saveState(state)
    console.log('job', state.job_id)
  }

  if (STAGE === 'refer') {
    console.log('vouching for the applicant', state.job_id)
    const result = await submit(c.REFERRER, 'refer', [
      state.job_id,
      createAccount(process.env.APPLICANT_PK).address,
      S.referralNote,
    ], 50_000_000_000_000_000n)
    state.referral_id = clean(result.payload)
    saveState(state)
    console.log('referral', state.referral_id)
  }

  if (STAGE === 'apply') {
    console.log('filing the application')
    const result = await submit(c.APPLICANT, 'apply', [
      state.job_id,
      S.applicationSummary,
      S.skills,
      S.applicationEvidence,
    ])
    state.app_id = clean(result.payload)
    saveState(state)
    console.log('application', state.app_id)
  }

  if (STAGE === 'screen') {
    console.log('asking validators to review the application (web + LLM)')
    const result = await submit(c.EMPLOYER, 'review_application', [
      state.job_id,
      createAccount(process.env.APPLICANT_PK).address,
    ])
    state.screening = result.payload
    saveState(state)
  }

  if (STAGE === 'hire') {
    console.log('hiring the applicant')
    const result = await submit(c.EMPLOYER, 'hire', [
      state.job_id,
      createAccount(process.env.APPLICANT_PK).address,
    ])
    state.hire = result.payload
    saveState(state)
  }

  if (STAGE === 'deliver') {
    console.log('submitting the delivered work')
    const result = await submit(c.APPLICANT, 'submit_work', [
      state.job_id,
      S.deliverySummary,
      S.deliveryEvidence,
    ])
    state.delivery = result.payload
    saveState(state)
  }

  if (STAGE === 'adjudicate') {
    console.log('asking validators for a delivery verdict (web + LLM)')
    const result = await submit(c.EMPLOYER, 'adjudicate', [state.job_id])
    state.verdict = result.payload
    saveState(state)
  }

  if (STAGE === 'appeal') {
    const job = await view(reader, 'get_job', [state.job_id])
    const share = (BigInt(job.escrow_atto) * 500n) / 10_000n
    const bond = share > 10_000_000_000_000_000n ? share : 10_000_000_000_000_000n
    console.log('appealing the verdict with', bond.toString(), 'atto')
    const result = await submit(
      c.EMPLOYER,
      'appeal',
      [
        state.job_id,
        S.appealStatement,
      ],
      bond,
    )
    state.appeal = result.payload
    saveState(state)
  }

  if (STAGE === 'reply') {
    console.log('filing the other party\'s answer to the appeal')
    const result = await submit(c.APPLICANT, 'reply_to_appeal', [
      state.job_id,
      S.replyStatement,
    ])
    state.reply = result.payload
    saveState(state)
  }

  if (STAGE === 'resolve') {
    console.log('asking validators to resolve the appeal (web + LLM)')
    const result = await submit(c.EMPLOYER, 'resolve_appeal', [state.job_id])
    state.appeal_verdict = result.payload
    saveState(state)
  }

  if (STAGE === 'settle') {
    console.log('settling escrow')
    const result = await submit(c.EMPLOYER, 'settle', [state.job_id])
    state.settled = result.payload
    saveState(state)
  }

  if (STAGE === 'show') {
    const job = await view(reader, 'get_job', [state.job_id])
    const stats = await view(reader, 'get_stats')
    console.log(JSON.stringify({ job, stats }, null, 2))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
