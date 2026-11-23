import { useEffect, useMemo, useState } from 'react'
import { IS_CONFIGURED, read } from './api'
import type { Application, Job, LedgerEntry, Referral, Terms } from './types'
import {
  atto,
  countdown,
  gen,
  num,
  pct,
  plural,
  sameAddress,
  short,
  stampDateTime,
} from './format'
import {
  ApplicationRow,
  Button,
  Chip,
  Empty,
  Field,
  Input,
  Money,
  Notice,
  Panel,
  Seal,
  Spinner,
  SplitBand,
  StatusPill,
  Timeline,
  isCandidate,
  isEmployer,
} from './ui'
import { navigate } from './router'

type Runner = (
  fn: string,
  args: unknown[],
  value: bigint,
  label: string,
) => Promise<{ ok?: boolean; payload?: string } | null | unknown>

const ROLE_LABELS: Record<string, string> = {
  PROTOCOL_FEE: 'Protocol fee',
  CANDIDATE_PAYOUT: 'Applicant payout',
  REFERRAL_BOUNTY: 'Referral bounty',
  EMPLOYER_REFUND: 'Employer refund',
  REFERRAL_BOND_RETURN: 'Referral bond returned',
  REFERRAL_BOND_SLASH: 'Referral bond slashed',
  REFERRAL_BOND_SHARE: 'Referral bond share',
  APPEAL_BOND_RETURN: 'Appeal bond returned',
  APPEAL_BOND_FORFEIT: 'Appeal bond forfeited',
}

export default function JobPage({
  jobId,
  account,
  refresh,
  run,
  connect,
}: {
  jobId: string
  account: string | null
  refresh: number
  run: Runner
  connect: () => Promise<void>
}) {
  const [job, setJob] = useState<Job | null>(null)
  const [terms, setTerms] = useState<Terms | null>(null)
  const [apps, setApps] = useState<Application[]>([])
  const [refs, setRefs] = useState<Referral[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [mine, setMine] = useState<Application | null>(null)
  const [myReferral, setMyReferral] = useState<Referral | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [referCandidate, setReferCandidate] = useState('')
  const [referNote, setReferNote] = useState('')
  const [pitch, setPitch] = useState('')
  const [skills, setSkills] = useState('')
  const [applyEvidence, setApplyEvidence] = useState('')
  const [summary, setSummary] = useState('')
  const [deliverEvidence, setDeliverEvidence] = useState('')
  const [statement, setStatement] = useState('')
  const [reply, setReply] = useState('')

  useEffect(() => {
    if (!IS_CONFIGURED) return
    let live = true
    setError(null)
    Promise.all([
      read<Job>('get_job', [jobId]),
      read<Terms>('get_terms'),
      read<Application[]>('list_applications', [jobId, 0, 50]),
      read<Referral[]>('list_referrals', [jobId, 0, 50]),
      read<LedgerEntry[]>('list_job_ledger', [jobId, 0, 50]),
    ])
      .then(([nextJob, nextTerms, nextApps, nextRefs, nextLedger]) => {
        if (!live) return
        setJob(nextJob)
        setTerms(nextTerms)
        setApps(nextApps)
        setRefs(nextRefs)
        setLedger(nextLedger)
      })
      .catch((err) => {
        if (live) setError(String((err as Error)?.message ?? err))
      })
    return () => {
      live = false
    }
  }, [jobId, refresh])

  useEffect(() => {
    if (!account || !IS_CONFIGURED) {
      setMine(null)
      setMyReferral(null)
      return
    }
    let live = true
    Promise.all([
      read<Application>('find_application', [jobId, account]).catch(() => ({}) as Application),
      read<Referral>('find_referral', [jobId, account]).catch(() => ({}) as Referral),
    ]).then(([app, referral]) => {
      if (!live) return
      setMine(app && app.app_id ? app : null)
      setMyReferral(referral && referral.referral_id ? referral : null)
    })
    return () => {
      live = false
    }
  }, [jobId, account, refresh])

  const now = Math.floor(Date.now() / 1000)
  const requiredAppeal = useMemo(() => {
    if (!job) return 0n
    const share = (BigInt(job.escrow_atto) * 500n) / 10_000n
    const floor = terms ? BigInt(terms.min_appeal_bond_atto) : 0n
    return share > floor ? share : floor
  }, [job, terms])

  if (error) {
    return (
      <div className="page">
        <Notice tone="bad">{error}</Notice>
        <Button tone="quiet" onClick={() => navigate('/board')}>
          Back to the board
        </Button>
      </div>
    )
  }
  if (!job) return <Spinner label="Opening the dossier" />
  if (!IS_CONFIGURED) return null

  const employer = isEmployer(job, account)
  const candidate = isCandidate(job, account)
  const isReferrer = Boolean(job.referrer) && sameAddress(job.referrer, account)
  const openForWork = job.status === 'OPEN' && now <= num(job.apply_by)
  const pastDelivery = job.status === 'HIRED' && now > num(job.deliver_by) + 3 * 86_400
  const canSettle =
    job.status === 'VERDICT' && (job.appeal_resolved || now > num(job.appeal_deadline))
  const canAppeal =
    job.status === 'VERDICT' &&
    !job.appeal_resolved &&
    now <= num(job.appeal_deadline) &&
    (employer || candidate)
  const maxAdjudications = terms ? num(terms.max_adjudications) : 4
  const canResolve =
    job.status === 'APPEALED' &&
    (Boolean(job.appeal_replier) || now > num(job.appeal_reply_deadline))
  const canReply =
    job.status === 'APPEALED' &&
    (employer || candidate) &&
    !sameAddress(job.appellant, account) &&
    !job.appeal_replier &&
    now <= num(job.appeal_reply_deadline)
  const canRecover =
    job.status === 'DELIVERED' &&
    (employer || candidate) &&
    num(job.stall_after) > 0 &&
    now >= num(job.stall_after)

  async function act(key: string, fn: string, args: unknown[], value: bigint, label: string) {
    setBusy(key)
    await run(fn, args, value, label)
    setBusy(null)
  }

  return (
    <div className="page">
      <button className="backlink" onClick={() => navigate('/board')}>
        ← The board
      </button>

      <article className="dossier">
        <header className="dossier-head">
          <div className="dossier-title">
            <div className="dossier-id mono">
              {job.job_id} · opened {stampDateTime(job.created_at)}
            </div>
            <h1>{job.title}</h1>
            <p className="dossier-role">{job.role}</p>
            <div className="dossier-tags">
              <StatusPill status={job.status} />
              <Chip tone={job.access_mode === 'REFERRAL' ? 'brass' : 'plain'}>
                {job.access_mode === 'REFERRAL'
                  ? `Referral only · score ${num(job.min_referrer_score)}+`
                  : 'Open applications'}
              </Chip>
              <Chip tone="plain">Employer {short(job.employer)}</Chip>
            </div>
          </div>
          <div className="dossier-seal">
            <Seal verdict={job.verdict && job.status !== 'SETTLED' ? job.verdict : undefined} status={job.status} />
            <div className="dossier-escrow">
              <span className="eyebrow">{job.status === 'SETTLED' ? 'Settled' : 'In escrow'}</span>
              <Money value={job.escrow_atto} />
            </div>
          </div>
        </header>

        <SplitBand job={job} />

        <div className="dossier-grid">
          <div className="dossier-left">
            <Panel eyebrow="The brief" title="What the work is">
              <div className="brief">
                <Field label="Requirements">{job.requirements}</Field>
                <Field label="Acceptance criteria">{job.deliverable_spec}</Field>
                <Field label="Evidence expected">{job.evidence_hint || '—'}</Field>
              </div>
            </Panel>

            <Panel eyebrow="Commitments" title="What is at stake">
              <div className="facts">
                <Field label="Referral bond" mono>
                  {gen(job.referral_bond_atto)} GEN
                </Field>
                <Field label="Apply closes" mono>
                  {stampDateTime(job.apply_by)} ·{' '}
                  {job.status === 'OPEN' ? countdown(job.apply_by) : 'closed'}
                </Field>
                <Field label="Delivery due" mono>
                  {job.deliver_by
                    ? `${stampDateTime(job.deliver_by)} · ${
                        job.status === 'HIRED' || job.status === 'DELIVERED' || job.status === 'VERDICT' || job.status === 'APPEALED'
                          ? countdown(job.deliver_by)
                          : 'closed'
                      }`
                    : `${plural(num(job.deliver_days), 'day')} after hire`}
                </Field>
                <Field label="Appeal window" mono>
                  {job.verdict ? `${countdown(job.appeal_deadline)} · bond ${gen(requiredAppeal)} GEN` : `${plural(num(job.appeal_days), 'day')} after verdict`}
                </Field>
                <Field label="Adjudication attempts" mono>
                  {num(job.adjudications)} of {maxAdjudications}
                </Field>
                {job.status === 'APPEALED' ? (
                  <Field label="Appeal response" mono>
                    {job.appeal_replier
                      ? `filed by ${short(job.appeal_replier)}`
                      : `${stampDateTime(job.appeal_reply_deadline)} · ${countdown(job.appeal_reply_deadline)}`}
                  </Field>
                ) : null}
                {job.status === 'DELIVERED' && num(job.stall_after) > 0 ? (
                  <Field label="Stall refund opens" mono>
                    {stampDateTime(job.stall_after)} · {countdown(job.stall_after)}
                  </Field>
                ) : null}
              </div>
            </Panel>

            <Panel
              eyebrow={`${apps.length} on file`}
              title="Applications"
              aside={<span className="mono panel-aside">screened by consensus</span>}
            >
              {apps.length === 0 ? (
                <Empty
                  title="No applications yet"
                  body={
                    job.access_mode === 'REFERRAL'
                      ? 'A referrer has to open the door before an application can be filed.'
                      : 'Anyone can apply while the window is open.'
                  }
                />
              ) : (
                <div className="app-list">
                  {apps.map((app) => (
                    <ApplicationRow
                      key={app.app_id}
                      app={app}
                      job={job}
                      employerView={employer}
                      busy={busy === 'review-' + app.candidate || busy === 'hire-' + app.candidate}
                      onReview={() =>
                        void act(
                          'review-' + app.candidate,
                          'review_application',
                          [job.job_id, app.candidate],
                          0n,
                          'Review application',
                        )
                      }
                      onHire={() =>
                        void act('hire-' + app.candidate, 'hire', [job.job_id, app.candidate], 0n, 'Hire applicant')
                      }
                    />
                  ))}
                </div>
              )}
            </Panel>

            <Panel eyebrow={`${refs.length} ${refs.length === 1 ? 'vouch' : 'vouches'}`} title="Referrals on this role">
              {refs.length === 0 ? (
                <Empty title="No referrers yet" body="A referrer stakes a bond to open the door for one candidate." />
              ) : (
                <div className="ref-list">
                  {refs.map((referral) => (
                    <div key={referral.referral_id} className="ref-row">
                      <div className="ref-main">
                        <div className="ref-line">
                          <span className="mono">{short(referral.referrer)}</span>
                          <span className="ref-arrow">→</span>
                          <span className="mono">{short(referral.candidate)}</span>
                        </div>
                        {referral.note ? <p className="ref-note">“{referral.note}”</p> : null}
                      </div>
                      <div className="ref-side">
                        <span className={`pill pill-${referral.status.toLowerCase()}`}>{referral.status}</span>
                        <span className="mono ref-bond">{gen(referral.bond_atto)} GEN</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel eyebrow="The money" title="Settlement ledger">
              {ledger.length === 0 ? (
                <p className="muted-copy">Nothing has left escrow yet.</p>
              ) : (
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Entry</th>
                      <th>Recipient</th>
                      <th>Role</th>
                      <th className="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((entry) => (
                      <tr key={entry.entry_id}>
                        <td className="mono">{entry.entry_id}</td>
                        <td className="mono">{short(entry.recipient)}</td>
                        <td>{ROLE_LABELS[entry.role] ?? entry.role}</td>
                        <td className="right mono">{gen(entry.amount_atto)} GEN</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>
                        Credited to balances
                        <span className="ledger-note">escrow plus bonds posted</span>
                      </td>
                      <td className="right mono">
                        {gen(ledger.reduce((sum, entry) => sum + atto(entry.amount_atto), 0n))} GEN
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </Panel>
          </div>

          <div className="dossier-right">
            <VerdictCard job={job} />

            {job.appealed ? (
              <Panel eyebrow="On the record" title="The appeal">
                <div className="appeal-record">
                  <Field label={`Appellant · ${short(job.appellant)}`}>
                    {job.appeal_statement || '—'}
                  </Field>
                  <Field
                    label={job.appeal_replier ? `Response · ${short(job.appeal_replier)}` : 'Response'}
                  >
                    {job.appeal_reply ||
                      (now > num(job.appeal_reply_deadline)
                        ? 'No response was filed within the window.'
                        : 'Awaiting the other party.')}
                  </Field>
                  <Field label="Bond">
                    {gen(job.appeal_bond_atto)} GEN
                    {job.bond_outcome
                      ? ` · ${job.bond_outcome.replaceAll('_', ' ').toLowerCase()}`
                      : ' at stake'}
                  </Field>
                </div>
              </Panel>
            ) : null}

            <Panel eyebrow="Your move" title="Actions">
              {!account ? (
                <div className="action-stack">
                  <p className="muted-copy">Connect a wallet to act on this dossier.</p>
                  <Button full onClick={() => void connect()}>
                    Connect wallet
                  </Button>
                </div>
              ) : null}

              {account && employer ? (
                <div className="action-block">
                  <div className="action-head">Employer controls</div>
                  <div className="action-stack">
                    {job.status === 'OPEN' ? (
                      <Button
                        tone="ghost"
                        full
                        busy={busy === 'cancel'}
                        onClick={() => void act('cancel', 'cancel_job', [job.job_id], 0n, 'Cancel role')}
                      >
                        Cancel and refund escrow
                      </Button>
                    ) : null}
                    {pastDelivery ? (
                      <Button
                        tone="ghost"
                        full
                        busy={busy === 'refund'}
                        onClick={() =>
                          void act('refund', 'refund_unfulfilled', [job.job_id], 0n, 'Claim unfulfilled refund')
                        }
                      >
                        Claim refund — no delivery
                      </Button>
                    ) : null}
                    {canSettle ? (
                      <Button
                        full
                        busy={busy === 'settle'}
                        onClick={() => void act('settle', 'settle', [job.job_id], 0n, 'Settle escrow')}
                      >
                        Settle escrow
                      </Button>
                    ) : null}
                    {canAppeal ? <AppealForm job={job} bond={requiredAppeal} statement={statement} setStatement={setStatement} busy={busy === 'appeal'} onSubmit={() => void act('appeal', 'appeal', [job.job_id, statement], requiredAppeal, 'Appeal verdict')} /> : null}
                  </div>
                </div>
              ) : null}

              {account && candidate ? (
                <div className="action-block">
                  <div className="action-head">Applicant controls</div>
                  <div className="action-stack">
                    {job.status === 'HIRED' ? (
                      <>
                        <label className="label">Delivery summary</label>
                        <Input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What was delivered, and where" />
                        <label className="label">Evidence URLs, one per line</label>
                        <textarea
                          className="input textarea"
                          rows={3}
                          value={deliverEvidence}
                          onChange={(event) => setDeliverEvidence(event.target.value)}
                          placeholder="https://github.com/you/repo/commit/..."
                        />
                        <Button
                          full
                          busy={busy === 'deliver'}
                          disabled={!summary || !deliverEvidence}
                          onClick={() =>
                            void act(
                              'deliver',
                              'submit_work',
                              [job.job_id, summary, deliverEvidence],
                              0n,
                              'Submit work',
                            )
                          }
                        >
                          Submit work for verification
                        </Button>
                      </>
                    ) : null}
                    {job.status === 'DELIVERED' ? (
                      <>
                        <p className="muted-copy">
                          Verdict pending. If a source was unreachable, repair the evidence before the
                          attempt cap is reached.
                        </p>
                        <label className="label">Repaired delivery summary</label>
                        <Input value={summary} onChange={(event) => setSummary(event.target.value)} />
                        <label className="label">Evidence URLs, one per line</label>
                        <textarea
                          className="input textarea"
                          rows={3}
                          value={deliverEvidence}
                          onChange={(event) => setDeliverEvidence(event.target.value)}
                        />
                        <Button
                          tone="ghost"
                          full
                          busy={busy === 'resubmit'}
                          disabled={!summary || !deliverEvidence}
                          onClick={() =>
                            void act(
                              'resubmit',
                              'resubmit_work',
                              [job.job_id, summary, deliverEvidence],
                              0n,
                              'Repair delivery',
                            )
                          }
                        >
                          Repair delivery evidence
                        </Button>
                      </>
                    ) : null}
                    {canAppeal ? <AppealForm job={job} bond={requiredAppeal} statement={statement} setStatement={setStatement} busy={busy === 'appeal'} onSubmit={() => void act('appeal', 'appeal', [job.job_id, statement], requiredAppeal, 'Appeal verdict')} /> : null}
                  </div>
                </div>
              ) : null}

              {account && !employer && !candidate && openForWork ? (
                <div className="action-block">
                  <div className="action-head">Open the door for a candidate</div>
                  <div className="action-stack">
                    {myReferral ? (
                      <Notice tone="ok">
                        You vouched for {short(myReferral.candidate)} with {gen(myReferral.bond_atto)} GEN at
                        stake. Status: {myReferral.status}.
                      </Notice>
                    ) : (
                      <>
                        <p className="muted-copy">
                          A referral is a bond, not a favour. If the applicant's evidence turns out to be
                          fabricated, the bond goes to the employer.
                        </p>
                        <label className="label">Candidate address</label>
                        <Input
                          value={referCandidate}
                          onChange={(event) => setReferCandidate(event.target.value)}
                          placeholder="0x…"
                        />
                        <label className="label">Why you vouch</label>
                        <Input
                          value={referNote}
                          onChange={(event) => setReferNote(event.target.value)}
                          placeholder="Worked with them on…"
                        />
                        <Button
                          full
                          busy={busy === 'refer'}
                          disabled={!referCandidate}
                          onClick={() =>
                            void act(
                              'refer',
                              'refer',
                              [job.job_id, referCandidate, referNote],
                              BigInt(job.referral_bond_atto),
                              'Vouch for candidate',
                            )
                          }
                        >
                          Stake {gen(job.referral_bond_atto)} GEN and refer
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              {account && !employer && openForWork && !mine ? (
                <div className="action-block">
                  <div className="action-head">Apply to this role</div>
                  <div className="action-stack">
                    <label className="label">Pitch</label>
                    <textarea
                      className="input textarea"
                      rows={3}
                      value={pitch}
                      onChange={(event) => setPitch(event.target.value)}
                      placeholder="What you have shipped that matches the brief"
                    />
                    <label className="label">Skills</label>
                    <Input value={skills} onChange={(event) => setSkills(event.target.value)} />
                    <label className="label">Evidence URLs, one per line</label>
                    <textarea
                      className="input textarea"
                      rows={3}
                      value={applyEvidence}
                      onChange={(event) => setApplyEvidence(event.target.value)}
                      placeholder="https://github.com/you"
                    />
                    <Button
                      full
                      busy={busy === 'apply'}
                      disabled={!pitch || !applyEvidence}
                      onClick={() =>
                        void act(
                          'apply',
                          'apply',
                          [job.job_id, pitch, skills, applyEvidence],
                          0n,
                          'File application',
                        )
                      }
                    >
                      File application
                    </Button>
                    {job.access_mode === 'REFERRAL' ? (
                      <p className="form-fine">
                        This role opens by referral. A referrer must stake a bond for your address before
                        the contract accepts the application.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {mine && job.status === 'OPEN' && !employer ? (
                <div className="action-block">
                  <div className="action-head">Your application</div>
                  <div className="action-stack">
                    <div className="inline-facts">
                      <Field label="Status">{mine.status}</Field>
                      <Field label="Screening">{mine.screening || 'not reviewed'}</Field>
                      <Field label="Fit" mono>
                        {num(mine.fit_score)}/100
                      </Field>
                    </div>
                    {mine.screening_notes ? <p className="app-notes">{mine.screening_notes}</p> : null}
                    {num(mine.screen_attempts) === 0 ? (
                      <Button
                        tone="quiet"
                        full
                        busy={busy === 'withdraw-app'}
                        onClick={() =>
                          void act(
                            'withdraw-app',
                            'withdraw_application',
                            [job.job_id],
                            0n,
                            'Withdraw application',
                          )
                        }
                      >
                        Withdraw application
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="action-block">
                <div className="action-head">Protocol actions</div>
                <div className="action-stack">
                  {job.status === 'DELIVERED' ? (
                    <Button
                      tone="ghost"
                      full
                      busy={busy === 'adjudicate'}
                      onClick={() =>
                        void act('adjudicate', 'adjudicate', [job.job_id], 0n, 'Adjudicate work')
                      }
                    >
                      Ask validators for a verdict
                    </Button>
                  ) : null}
                  {canReply ? (
                    <div className="action-block">
                      <div className="action-head">Answer this appeal</div>
                      <p className="muted-copy">
                        The panel reads both authenticated statements, then re-derives the verdict
                        from the evidence. Statements are argument, not evidence.
                      </p>
                      <label className="label">Why the verdict should stand</label>
                      <textarea
                        className="input textarea"
                        rows={3}
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        placeholder="Point the panel at what the delivery actually contains"
                      />
                      <Button
                        full
                        busy={busy === 'reply'}
                        disabled={!reply}
                        onClick={() =>
                          void act('reply', 'reply_to_appeal', [job.job_id, reply], 0n, 'Answer appeal')
                        }
                      >
                        File your answer
                      </Button>
                    </div>
                  ) : null}
                  {canResolve ? (
                    <Button
                      tone="ghost"
                      full
                      busy={busy === 'resolve'}
                      onClick={() =>
                        void act('resolve', 'resolve_appeal', [job.job_id], 0n, 'Resolve appeal')
                      }
                    >
                      Resolve the appeal
                    </Button>
                  ) : null}
                  {job.status === 'APPEALED' && !canResolve ? (
                    <p className="muted-copy">
                      Resolution opens when the other party answers, or when the reply window
                      closes on {stampDateTime(job.appeal_reply_deadline)}.
                    </p>
                  ) : null}
                  {job.status === 'OPEN' && now > num(job.apply_by) ? (
                    <Button
                      tone="quiet"
                      full
                      busy={busy === 'expire'}
                      onClick={() => void act('expire', 'expire_job', [job.job_id], 0n, 'Expire role')}
                    >
                      Close an expired role
                    </Button>
                  ) : null}
                  {canSettle ? (
                    <Button
                      tone="ghost"
                      full
                      busy={busy === 'settle'}
                      onClick={() => void act('settle', 'settle', [job.job_id], 0n, 'Settle escrow')}
                    >
                      Settle escrow
                    </Button>
                  ) : null}
                  {job.status === 'VERDICT' && !canSettle ? (
                    <p className="muted-copy">Settlement opens when the appeal window closes.</p>
                  ) : null}
                  {canRecover ? (
                    <Button
                      tone="quiet"
                      full
                      busy={busy === 'recover'}
                      onClick={() =>
                        void act(
                          'recover',
                          'recover_stalled_escrow',
                          [job.job_id],
                          0n,
                          'Recover stalled escrow',
                        )
                      }
                    >
                      Recover the stalled escrow
                    </Button>
                  ) : null}
                  {job.status === 'DELIVERED' && !canRecover && num(job.stall_after) > 0 ? (
                    <p className="muted-copy">
                      Adjudication is still open. If no verdict lands by {stampDateTime(job.stall_after)},
                      either party can recover the escrow and close the dossier.
                    </p>
                  ) : null}
                  {job.status === 'SETTLED' ? (
                    <p className="muted-copy">Settlement is on the ledger. Withdraw from the sidebar.</p>
                  ) : null}
                  {job.status === 'STALLED' ? (
                    <p className="muted-copy">
                      No verdict was possible within the adjudication budget. The escrow and the
                      referral bond have been returned.
                    </p>
                  ) : null}
                  {isReferrer ? (
                    <p className="muted-copy">
                      You are the selected referrer. Your bond and bounty clear at settlement.
                    </p>
                  ) : null}
                </div>
              </div>
            </Panel>

            <Panel eyebrow="The file" title="How this dossier moved">
              <Timeline job={job} />
            </Panel>
          </div>
        </div>
      </article>
    </div>
  )
}

function AppealForm({
  job,
  bond,
  statement,
  setStatement,
  busy,
  onSubmit,
}: {
  job: Job
  bond: bigint
  statement: string
  setStatement: (value: string) => void
  busy: boolean
  onSubmit: () => void
}) {
  return (
    <div className="appeal-form">
      <p className="muted-copy">
        One appeal per dossier. Stake {gen(bond)} GEN. If the verdict moves in your favour the bond comes
        back; if it holds, the bond goes to the other party.
      </p>
      <label className="label">Why the verdict is wrong</label>
      <textarea
        className="input textarea"
        rows={3}
        value={statement}
        onChange={(event) => setStatement(event.target.value)}
        placeholder="Point to the evidence the panel should re-read"
      />
      <Button full tone="danger" busy={busy} disabled={!statement} onClick={onSubmit}>
        Appeal with {gen(bond)} GEN
      </Button>
      <div className="mono appeal-ref">prior ratio {pct(job.payout_ratio_bps)}</div>
    </div>
  )
}

function VerdictCard({ job }: { job: Job }) {
  if (job.status === 'STALLED') {
    return (
      <Panel eyebrow="No verdict" title="Stalled, then refunded">
        <p className="muted-copy">
          No verdict was reached within seven days of delivery, so the dossier was closed. The
          escrow went back to the employer and the referral bond went back to the referrer. A
          stalled delivery is not scored as a failed one.
        </p>
      </Panel>
    )
  }
  if (!job.verdict) {
    return (
      <Panel eyebrow="Verdict" title="No stamp yet">
        <p className="muted-copy">
          Validators have not judged this delivery. The stamp appears when consensus agrees on the
          exact ratio that escrow pays.
        </p>
      </Panel>
    )
  }
  const sources = job.cited_sources.split('\n').filter(Boolean)
  return (
    <section className={`verdict verdict-${job.verdict.toLowerCase()}`}>
      <div className="verdict-head">
        <div>
          <div className="eyebrow">Consensus stamp</div>
          <div className="verdict-word">{job.verdict}</div>
        </div>
        <div className="verdict-ratio">
          <span>{pct(job.payout_ratio_bps)}</span>
          <small>of the split</small>
        </div>
      </div>
      <p className="verdict-reason">{job.rationale.split(' | ')[0]}</p>
      <div className="verdict-facts">
        <Field label="Confidence" mono>
          {num(job.confidence)}%
        </Field>
        <Field label="Applicant" mono>
          {gen(job.candidate_paid_atto || job.verdict_candidate_atto)} GEN
        </Field>
        <Field label="Referrer" mono>
          {gen(job.referrer_paid_atto || job.verdict_referrer_atto)} GEN
        </Field>
        <Field label="Appeal" mono>
          {job.appealed ? (job.appeal_resolved ? 'resolved' : 'open') : 'none filed'}
        </Field>
      </div>
      {sources.length ? (
        <div className="verdict-sources">
          <span className="eyebrow">Sources read</span>
          {sources.map((source) => (
            <a key={source} href={source} target="_blank" rel="noreferrer" className="mono">
              {source}
            </a>
          ))}
        </div>
      ) : null}
      {job.rationale.split(' | ').length > 1 ? (
        <div className="verdict-criteria">
          {job.rationale
            .split(' | ')
            .slice(1)
            .map((line) => (
              <span key={line} className="mono">
                {line}
              </span>
            ))}
        </div>
      ) : null}
      {job.evidence_status ? <div className="verdict-evidence mono">{job.evidence_status}</div> : null}
    </section>
  )
}
