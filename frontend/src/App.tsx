import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CONTRACT,
  IS_CONFIGURED,
  NETWORK_NAME,
  connectWallet,
  ensureChain,
  explorerTx,
  read,
  silentAccount,
  walletClient,
  write,
} from './api'
import type { Job, Profile, Stats, Terms, TxRun, Wallet } from './types'
import { gen, num, parseGen, sameAddress, short } from './format'
import { Button, Chip, Empty, Input, Notice, Panel, Spinner, StatusPill } from './ui'
import JobPage from './JobPage'
import PassportPage from './PassportPage'
import ProtocolPage from './ProtocolPage'
import LandingPage from './LandingPage'
import { navigate } from './router'

type Route =
  | { name: 'landing' }
  | { name: 'board' }
  | { name: 'job'; id: string }
  | { name: 'passport'; address?: string }
  | { name: 'protocol' }

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const parts = hash.split('/').filter(Boolean)
  if (!parts.length) return { name: 'landing' }
  if (parts[0] === 'board') return { name: 'board' }
  if (parts[0] === 'job' && parts[1]) return { name: 'job', id: decodeURIComponent(parts[1]) }
  if (parts[0] === 'passport') {
    return { name: 'passport', address: parts[1] ? decodeURIComponent(parts[1]) : undefined }
  }
  if (parts[0] === 'protocol') return { name: 'protocol' }
  return { name: 'landing' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [txRun, setTxRun] = useState<TxRun | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [credit, setCredit] = useState<bigint>(0n)
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all')

  useEffect(() => {
    const onHash = () => {
      // A `#section` link is a fragment jump, not a route change: let the browser
      // move the page itself and never yank it back to the top.
      const isFragment = !window.location.hash.startsWith('#/')
      setRoute(parseRoute())
      if (!isFragment) window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    void silentAccount().then((address) => {
      if (address && window.ethereum) {
        setAccount(address)
        setWallet({ address, provider: window.ethereum })
      }
    })
  }, [])

  useEffect(() => {
    if (!account || !IS_CONFIGURED) {
      setProfile(null)
      setCredit(0n)
      return
    }
    read<Profile>('get_profile', [account])
      .then(setProfile)
      .catch(() => setProfile(null))
    read<number>('get_credit', [account])
      .then((value) => setCredit(BigInt(value)))
      .catch(() => setCredit(0n))
  }, [account, refresh])

  const client = useMemo(
    () => (wallet && account ? walletClient(account, wallet.provider) : null),
    [wallet, account],
  )

  const run = useCallback(
    async (fn: string, args: unknown[], value: bigint, label: string) => {
      if (!client) {
        setNotice({ tone: 'bad', text: 'Connect a wallet to sign transactions.' })
        return null
      }
      if (wallet) {
        try {
          await ensureChain(wallet.provider)
        } catch (err) {
          const text = String((err as Error)?.message ?? err)
          setNotice({ tone: 'bad', text: 'Switch the wallet to the GenLayer network first. ' + text })
          return null
        }
      }
      setNotice(null)
      setTxRun({ label, stage: 'SIGNING' })
      try {
        const result = await write(client, fn, args, value, setTxRun, label)
        setTxRun({
          label,
          stage: result.ok ? 'FINALIZED' : 'FAILED',
          hash: result.hash,
          status: result.status,
          payload: result.payload,
        })
        if (result.ok) {
          setNotice({
            tone: 'ok',
            text: result.payload ? `${label} confirmed — returned ${result.payload}` : `${label} confirmed.`,
          })
        } else {
          setNotice({
            tone: 'bad',
            text: `${label} did not execute (${result.execution}). ${result.payload || 'Check the transaction for the contract error.'}`,
          })
        }
        setRefresh((value) => value + 1)
        return result
      } catch (err) {
        const text = String((err as Error)?.message ?? err)
        setTxRun({ label, stage: 'FAILED', error: text })
        setNotice({ tone: 'bad', text })
        return null
      }
    },
    [client, wallet],
  )

  async function connect(): Promise<boolean> {
    try {
      const session = await connectWallet()
      setAccount(session.address)
      setWallet({ address: session.address, provider: session.provider })
      setNotice({ tone: 'info', text: 'Wallet connected as ' + session.address })
      return true
    } catch (err) {
      setNotice({ tone: 'bad', text: String((err as Error)?.message ?? err) })
      return false
    }
  }

  if (route.name === 'landing') return <LandingPage />

  const boardActive = route.name === 'board'

  return (
    <div className="shell">
      <aside className="rail">
        <button className="brand" onClick={() => navigate('/')}>
          <img src="/seal.svg" alt="" width={38} height={38} />
          <span>
            <span className="brand-name">Portico</span>
            <span className="brand-sub">access by referral</span>
          </span>
        </button>

        <nav className="nav">
          <button className={boardActive ? 'nav-item active' : 'nav-item'} onClick={() => navigate('/board')}>
            <span className="nav-index">01</span> The board
          </button>
          <button
            className={route.name === 'passport' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/passport')}
          >
            <span className="nav-index">02</span> Passport
          </button>
          <button
            className={route.name === 'protocol' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('/protocol')}
          >
            <span className="nav-index">03</span> Protocol
          </button>
        </nav>

        <div className="rail-card">
          <div className="eyebrow">Your clearance</div>
          {account ? (
            <>
              <div className="rail-score">
                {profile ? num(profile.score) : '—'}
                <span>/1000</span>
              </div>
              <div className="rail-addr mono">{short(account)}</div>
              <div className="rail-credit">
                <span>Withdrawable</span>
                <b>{gen(credit)} GEN</b>
              </div>
              <Button
                tone="ghost"
                full
                disabled={credit <= 0n}
                onClick={() => void run('withdraw', [], 0n, 'Withdraw')}
              >
                Withdraw balance
              </Button>
            </>
          ) : (
            <>
              <p className="rail-copy">
                Connect a wallet to post a role, vouch for someone, apply, or collect what the
                protocol owes you.
              </p>
              <Button full onClick={() => void connect()}>
                Connect wallet
              </Button>
            </>
          )}
        </div>

        <div className="rail-foot">
          <div className="rail-net">
            <span className="dot" /> {NETWORK_NAME}
          </div>
          <div className="mono rail-contract" title={CONTRACT}>
            {IS_CONFIGURED ? short(CONTRACT) : 'no contract set'}
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-crumb">
            {route.name === 'board'
              ? 'Referral-gated hiring · GenLayer'
              : route.name === 'job'
                ? 'Dossier ' + route.id
                : route.name === 'passport'
                  ? 'Portable reputation'
                  : 'How the protocol clears'}
          </div>
          <div className="topbar-right">
            <Chip tone="brass">Work verified by consensus</Chip>
            <Chip tone="plain">Paid on outcome</Chip>
          </div>
        </header>

        {!IS_CONFIGURED ? (
          <Notice tone="info">
            No contract address is configured. Copy <code>frontend/.env.example</code> to{' '}
            <code>frontend/.env.local</code>, set <code>VITE_CONTRACT_ADDRESS</code>, and reload.
          </Notice>
        ) : null}

        {notice ? (
          <Notice tone={notice.tone}>
            {notice.text}
            {txRun?.hash && explorerTx(txRun.hash) ? (
              <>
                {' '}
                <a href={explorerTx(txRun.hash)} target="_blank" rel="noreferrer">
                  transaction
                </a>
              </>
            ) : null}
          </Notice>
        ) : null}

        {route.name === 'board' ? (
          <Board
            account={account}
            refresh={refresh}
            run={run}
            connect={connect}
            filter={boardFilter}
            setFilter={setBoardFilter}
          />
        ) : null}
        {route.name === 'job' ? (
          <JobPage
            jobId={route.id}
            account={account}
            refresh={refresh}
            run={run}
            connect={connect}
          />
        ) : null}
        {route.name === 'passport' ? (
          <PassportPage
            address={route.address ?? account ?? ''}
            account={account}
            refresh={refresh}
            run={run}
            connect={connect}
          />
        ) : null}
        {route.name === 'protocol' ? <ProtocolPage /> : null}

        <footer className="foot">
          <span>Portico · an intelligent contract on GenLayer</span>
          <span className="mono">{CONTRACT || 'contract address pending'}</span>
        </footer>
      </main>
    </div>
  )
}

type BoardFilter = 'all' | 'open' | 'active' | 'settled' | 'mine'

const BOARD_FILTERS: { id: BoardFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'active', label: 'Active' },
  { id: 'settled', label: 'Settled' },
  { id: 'mine', label: 'Mine' },
]

const IN_FLIGHT = new Set(['HIRED', 'DELIVERED', 'VERDICT', 'APPEALED'])

function Board({
  account,
  refresh,
  run,
  connect,
  filter,
  setFilter,
}: {
  account: string | null
  refresh: number
  run: (fn: string, args: unknown[], value: bigint, label: string) => Promise<unknown>
  connect: () => Promise<boolean>
  filter: BoardFilter
  setFilter: (filter: BoardFilter) => void
}) {
  const [terms, setTerms] = useState<Terms | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const postRef = useRef<HTMLDivElement>(null)

  /** One click from the hero: connect if needed, then reveal the posting form. */
  async function startPosting() {
    if (posting) {
      setPosting(false)
      return
    }
    const ready = account ? true : await connect()
    if (ready) setPosting(true)
  }

  useEffect(() => {
    if (posting) postRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [posting])

  useEffect(() => {
    if (!IS_CONFIGURED) return
    let live = true
    setError(null)
    Promise.all([
      read<Terms>('get_terms'),
      read<Stats>('get_stats'),
      read<Job[]>('list_jobs', [0, 40]),
    ])
      .then(([nextTerms, nextStats, nextJobs]) => {
        if (!live) return
        setTerms(nextTerms)
        setStats(nextStats)
        setJobs(nextJobs)
      })
      .catch((err) => {
        if (live) setError(String((err as Error)?.message ?? err))
      })
    return () => {
      live = false
    }
  }, [refresh])

  const allJobs = jobs ?? []
  const isMine = (job: Job) =>
    sameAddress(job.employer, account) ||
    sameAddress(job.candidate, account) ||
    (Boolean(job.referrer) && sameAddress(job.referrer, account))

  const buckets: Record<BoardFilter, Job[]> = {
    all: allJobs,
    open: allJobs.filter((job) => job.status === 'OPEN'),
    active: allJobs.filter((job) => IN_FLIGHT.has(job.status)),
    settled: allJobs.filter((job) => job.status === 'SETTLED'),
    mine: account ? allJobs.filter(isMine) : [],
  }
  const visible = buckets[filter]

  const emptyCopy = {
    all: {
      title: 'No roles posted yet',
      body: 'The first dossier sets the terms: escrow, acceptance criteria, and the split between applicant and referrer.',
    },
    open: {
      title: 'No roles are taking applications',
      body: 'Post a role, or switch to Settled to read how earlier dossiers ended and what they paid.',
    },
    active: {
      title: 'Nothing is in flight',
      body: 'Hired roles, deliveries waiting on a verdict and live appeals appear here until they settle.',
    },
    settled: {
      title: 'No settled dossiers yet',
      body: 'A dossier lands here once a verdict has paid the applicant and the referrer and closed the escrow.',
    },
    mine: {
      title: account ? 'No dossiers include you yet' : 'Connect to see your dossiers',
      body: account
        ? 'Post a role, vouch for someone, or apply — anything your wallet is party to appears here.'
        : 'Your roles, applications and vouches are read from the wallet that signed them.',
    },
  }[filter]

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-eyebrow">
          <span className="rule" /> Future of work · verified outcome
        </div>
        <h1>
          A referral opens the door.
          <br />
          The work <em>pays</em> for itself.
        </h1>
        <p className="hero-copy">
          Portico keeps the whole hire in escrow. A referrer stakes a bond to open access. GenLayer
          validators read the applicant's evidence and the delivered work, independently, then stamp
          a verdict. The applicant and the referrer are paid from that stamp — not from an operator's
          approval.
        </p>
        <div className="hero-actions">
          <Button onClick={() => void startPosting()}>
            {posting ? 'Close the form' : 'Post a role'}
            <span className="btn-arrow" aria-hidden>
              {posting ? '×' : '→'}
            </span>
          </Button>
          <Button tone="ghost" onClick={() => navigate('/protocol')}>
            Read the mechanics
            <span className="btn-arrow" aria-hidden>
              →
            </span>
          </Button>
        </div>
        <p className="hero-start">
          <b>Start here.</b> Connect a wallet, write the role and fund the escrow — the panel's verdict
          releases the payout.
        </p>
      </section>

      <section className="ledger-strip" aria-label="Protocol ledger">
        <div className="ledger-cell">
          <span className="ledger-label">In escrow, lifetime</span>
          <span className="ledger-value">{gen(stats?.escrowed_atto)}<i>GEN</i></span>
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Paid on outcome</span>
          <span className="ledger-value">{gen(stats?.paid_out_atto)}<i>GEN</i></span>
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Bonds slashed</span>
          <span className="ledger-value">{gen(stats?.bonds_slashed_atto)}<i>GEN</i></span>
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Dossiers settled</span>
          <span className="ledger-value">
            {num(stats?.jobs_settled)}
            <i>of {num(stats?.jobs_posted)}</i>
          </span>
        </div>
      </section>

      {posting ? (
        <div className="post-anchor" ref={postRef}>
          <PostForm terms={terms} run={run} onDone={() => setPosting(false)} />
        </div>
      ) : null}

      <section className="board">
        <div className="board-head">
          <h2>The board</h2>
          <div className="board-meta mono">
            {jobs
              ? `${visible.length}${visible.length !== jobs.length ? ` of ${jobs.length}` : ''} ${visible.length === 1 ? 'dossier' : 'dossiers'}`
              : 'reading the chain'}{' '}
            · fee {terms ? num(terms.fee_bps) / 100 : '—'}%
          </div>
        </div>

        <div className="board-bar">
          <div className="board-tabs" role="group" aria-label="Filter the board">
            {BOARD_FILTERS.map((item) => {
              const active = filter === item.id
              const count = buckets[item.id].length
              return (
                <button
                  key={item.id}
                  className={`board-tab${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  <span className="board-tab-count">{count}</span>
                </button>
              )
            })}
          </div>
        </div>

        {error ? <Notice tone="bad">{error}</Notice> : null}
        {!jobs && !error ? <Spinner /> : null}
        {jobs && visible.length === 0 ? (
          <>
            <Empty title={emptyCopy.title} body={emptyCopy.body} />
            {filter === 'mine' && !account ? (
              <div className="board-empty-action">
                <Button tone="ghost" onClick={() => void connect()}>
                  Connect wallet
                </Button>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="job-list">
          {visible.map((job) => (
            <button key={job.job_id} className="job-row" onClick={() => navigate('/job/' + job.job_id)}>
              <span className={`job-flag flag-${job.status.toLowerCase()}`} />
              <span className="job-main">
                <span className="job-top">
                  <span className="job-id mono">{job.job_id}</span>
                  <StatusPill status={job.status} />
                  <span className="job-access">
                    {job.access_mode === 'REFERRAL'
                      ? `referral · score ${num(job.min_referrer_score)}+`
                      : 'open applications'}
                  </span>
                </span>
                <span className="job-title">{job.title}</span>
                <span className="job-sub">{job.role}</span>
              </span>
              <span className="job-side">
                <span className="job-money">{gen(job.escrow_atto)} GEN</span>
                <span className="job-employer mono">{short(job.employer)}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

const EMPTY_FORM = {
  title: 'Backend engineer — health endpoint',
  role: 'Ship a small, production-ready health endpoint for a payments API, with tests and a deploy note.',
  requirements: 'Three years of Python backend work. HTTP APIs. Automated tests. Can work from a written spec without meetings.',
  criteria:
    'A GET /health endpoint that returns {"status":"ok"} with HTTP 200. A passing test suite committed alongside it. A README line that explains how to run it.',
  evidence: 'A public repository, a deployed URL, or a commit hash a reviewer can open.',
  mode: 'REFERRAL',
  minScore: '500',
  candidateBps: '7000',
  escrow: '10',
  bond: '0.05',
  applyDays: '7',
  deliverDays: '14',
  appealDays: '3',
}

function PostForm({
  terms,
  run,
  onDone,
}: {
  terms: Terms | null
  run: (fn: string, args: unknown[], value: bigint, label: string) => Promise<unknown>
  onDone: () => void
}) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const feeBps = terms ? num(terms.fee_bps) : 300
  const candidateBps = Number(form.candidateBps) || 0
  const referrerBps = Math.max(0, 10_000 - feeBps - candidateBps)
  const valid =
    candidateBps > 0 &&
    referrerBps >= 0 &&
    (form.mode === 'OPEN' || referrerBps > 0) &&
    Number(form.escrow) > 0

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit() {
    setBusy(true)
    const result = (await run(
      'post_job',
      [
        form.title,
        form.role,
        form.requirements,
        form.criteria,
        form.evidence,
        form.mode,
        Number(form.minScore),
        candidateBps,
        referrerBps,
        parseGen(form.bond),
        Number(form.applyDays),
        Number(form.deliverDays),
        Number(form.appealDays),
      ],
      parseGen(form.escrow),
      'Post role',
    )) as { payload?: string; ok?: boolean } | null
    setBusy(false)
    if (result?.ok) {
      onDone()
      const id = String(result.payload ?? '').trim()
      if (/^J\d+$/.test(id)) navigate('/job/' + id)
    }
  }

  return (
    <Panel
      eyebrow="New dossier"
      title="Post a role with its acceptance criteria"
      aside={
        <div className="form-note">
          fee {feeBps / 100}% · applicant {candidateBps / 100}% · referrer {referrerBps / 100}%
        </div>
      }
    >
      <div className="form-grid">
        <div className="form-col">
          <label className="label">Role title</label>
          <Input value={form.title} onChange={(event) => set('title', event.target.value)} />
          <label className="label">What the hire is for</label>
          <Input value={form.role} onChange={(event) => set('role', event.target.value)} />
          <label className="label">Requirements the applicant must evidence</label>
          <textarea
            className="input textarea"
            rows={3}
            value={form.requirements}
            onChange={(event) => set('requirements', event.target.value)}
          />
          <label className="label">Acceptance criteria (the verdict rubric)</label>
          <textarea
            className="input textarea"
            rows={4}
            value={form.criteria}
            onChange={(event) => set('criteria', event.target.value)}
          />
          <label className="label">What evidence you expect at delivery</label>
          <Input value={form.evidence} onChange={(event) => set('evidence', event.target.value)} />
        </div>

        <div className="form-col form-terms">
          <div className="split-fields">
            <div>
              <label className="label">Escrow (GEN)</label>
              <Input value={form.escrow} onChange={(event) => set('escrow', event.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label className="label">Referral bond (GEN)</label>
              <Input value={form.bond} onChange={(event) => set('bond', event.target.value)} inputMode="decimal" />
            </div>
          </div>
          <label className="label">Access</label>
          <div className="segmented">
            <button
              className={form.mode === 'REFERRAL' ? 'seg active' : 'seg'}
              onClick={() => set('mode', 'REFERRAL')}
            >
              Referral only
            </button>
            <button className={form.mode === 'OPEN' ? 'seg active' : 'seg'} onClick={() => set('mode', 'OPEN')}>
              Open
            </button>
          </div>
          <label className="label">Minimum referrer score</label>
          <Input
            value={form.minScore}
            onChange={(event) => set('minScore', event.target.value)}
            inputMode="numeric"
          />
          <label className="label">Applicant share (bps of escrow)</label>
          <Input
            value={form.candidateBps}
            onChange={(event) => set('candidateBps', event.target.value)}
            inputMode="numeric"
          />
          <div className="form-ratio">
            <span>Applicant {candidateBps / 100}%</span>
            <span>Referrer {referrerBps / 100}%</span>
            <span>Fee {feeBps / 100}%</span>
          </div>
          <div className="split-fields">
            <div>
              <label className="label">Apply window (days)</label>
              <Input value={form.applyDays} onChange={(event) => set('applyDays', event.target.value)} />
            </div>
            <div>
              <label className="label">Delivery window (days)</label>
              <Input value={form.deliverDays} onChange={(event) => set('deliverDays', event.target.value)} />
            </div>
            <div>
              <label className="label">Appeal window (days)</label>
              <Input value={form.appealDays} onChange={(event) => set('appealDays', event.target.value)} />
            </div>
          </div>
          <Button full busy={busy} disabled={!valid} onClick={() => void submit()}>
            Fund escrow and publish
          </Button>
          <p className="form-fine">
            The escrow is held by the contract. Settlement releases the applicant share and the
            referrer bounty at the verified ratio, the protocol fee, and refunds the remainder to you.
          </p>
        </div>
      </div>
    </Panel>
  )
}
