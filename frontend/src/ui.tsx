import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import type { Application, Job, Num, Profile } from './types'
import { countdown, gen, pct, sameAddress, short, titleCase, num } from './format'

export function Seal({ verdict, status, small }: { verdict?: string; status?: string; small?: boolean }) {
  const text = verdict || status || 'OPEN'
  const tone = verdict ? verdict.toLowerCase() : (status || 'open').toLowerCase()
  return (
    <div className={`seal seal-${tone}${small ? ' seal-sm' : ''}`} aria-label={`Status ${text}`}>
      <span className="seal-inner">
        <span className="seal-word">{text}</span>
        <span className="seal-sub">portico</span>
      </span>
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${status.toLowerCase()}`}>{titleCase(status)}</span>
}

export function Chip({ tone = 'plain', children }: { tone?: string; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

export function Money({ value, digits = 2 }: { value: Num | undefined | null; digits?: number }) {
  return (
    <span className="money">
      {gen(value, digits)}
      <span className="money-unit">GEN</span>
    </span>
  )
}

export function Field({
  label,
  children,
  mono,
}: {
  label: string
  children: ReactNode
  mono?: boolean
}) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className={`field-value${mono ? ' mono' : ''}`}>{children}</div>
    </div>
  )
}

export function Copy({ value }: { value: string }) {
  return (
    <button
      type="button"
      className="copy"
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value)
      }}
    >
      {short(value)}
    </button>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="label">{children}</label>
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input textarea ${props.className ?? ''}`} />
}

export function Button({
  children,
  onClick,
  tone = 'primary',
  disabled,
  busy,
  type = 'button',
  full,
}: {
  children: ReactNode
  onClick?: () => void
  tone?: 'primary' | 'ghost' | 'quiet' | 'danger'
  disabled?: boolean
  busy?: boolean
  type?: 'button' | 'submit'
  full?: boolean
}) {
  return (
    <button
      type={type}
      className={`btn btn-${tone}${full ? ' btn-full' : ''}`}
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy ? <span className="dot-pulse" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function Notice({ tone, children }: { tone: 'ok' | 'bad' | 'info'; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>
}

export function Panel({
  eyebrow,
  title,
  children,
  aside,
}: {
  eyebrow?: string
  title?: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className="panel">
      {(eyebrow || title || aside) && (
        <header className="panel-head">
          <div>
            {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
            {title ? <h2>{title}</h2> : null}
          </div>
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

export function Spinner({ label = 'Reading the chain' }: { label?: string }) {
  return (
    <div className="loading">
      <span className="dot-pulse" />
      <span>{label}</span>
    </div>
  )
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <div className="empty-rule" />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  )
}

export function SplitBand({ job }: { job: Job }) {
  const escrow = Number(job.escrow_atto)
  const ratio = job.verdict ? num(job.payout_ratio_bps) / 10_000 : 1
  const segments = [
    { key: 'candidate', label: 'Applicant', bps: num(job.candidate_bps), tone: 'candidate' },
    { key: 'referrer', label: 'Referrer', bps: num(job.referrer_bps), tone: 'referrer' },
    { key: 'fee', label: 'Fee', bps: num(job.fee_bps), tone: 'fee' },
  ]
  const paid = segments.reduce((sum, segment) => sum + (segment.bps / 10_000) * escrow * ratio, 0)
  const refund = Math.max(0, escrow - paid)
  return (
    <div className="split">
      <div className="split-bar">
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`split-seg split-${segment.tone}`}
            style={{ width: `${(segment.bps / 10_000) * 100 * ratio}%` }}
            title={`${segment.label} ${pct(segment.bps)}`}
          />
        ))}
        <span className="split-seg split-refund" style={{ width: `${(refund / escrow) * 100}%` }} />
      </div>
      <div className="split-legend">
        {segments.map((segment) => (
          <span key={segment.key} className="split-item">
            <i className={`swatch swatch-${segment.tone}`} />
            {segment.label}
            <b>{pct(segment.bps * ratio, 1)}</b>
            <span className="split-gen">{gen((segment.bps / 10_000) * escrow * ratio)} GEN</span>
          </span>
        ))}
        <span className="split-item">
          <i className="swatch swatch-refund" />
          Refund
          <b>{escrow > 0 ? pct((refund / escrow) * 10_000, 1) : '0%'}</b>
          <span className="split-gen">{gen(refund)} GEN</span>
        </span>
      </div>
      <div className="split-caption">
        {job.verdict
          ? `Stamped at ${pct(job.payout_ratio_bps)} · shares of escrow, rounded`
          : `Full split if the work passes. Escrow ${gen(escrow)} GEN.`}
      </div>
    </div>
  )
}

export function Timeline({ job }: { job: Job }) {
  const steps = [
    {
      key: 'posted',
      title: 'Posted and funded',
      at: job.created_at,
      note: `${gen(job.escrow_atto)} GEN in escrow · ${job.access_mode === 'REFERRAL' ? 'referral only' : 'open applications'}`,
      done: true,
    },
    {
      key: 'hired',
      title: job.candidate ? 'Applicant hired' : 'Awaiting a hire',
      at: job.hired_at,
      note: job.candidate ? short(job.candidate) + (job.referrer ? ' · vouched by ' + short(job.referrer) : ' · direct') : `closes ${countdown(job.apply_by)}`,
      done: Boolean(job.candidate),
    },
    {
      key: 'delivered',
      title: job.delivered_at ? 'Work delivered' : 'Awaiting delivery',
      at: job.delivered_at,
      note: job.delivered_at ? 'Evidence committed for review' : job.deliver_by ? `due ${countdown(job.deliver_by)}` : 'starts at hire',
      done: Boolean(job.delivered_at),
    },
    {
      key: 'verdict',
      title:
        job.status === 'STALLED'
          ? 'No verdict · stalled'
          : job.verdict
            ? `Verdict: ${job.verdict}`
            : 'Consensus pending',
      at: job.adjudicated_at,
      note:
        job.status === 'STALLED'
          ? 'no verdict was reached within the seven-day window'
          : job.verdict
            ? `${pct(job.payout_ratio_bps)} · confidence ${num(job.confidence)}%`
            : 'validators read the evidence',
      done: Boolean(job.verdict) || job.status === 'STALLED',
    },
    ...(job.appealed
      ? [
          {
            key: 'appeal',
            title: job.appeal_resolved ? 'Appeal decided' : 'Appeal filed',
            at: 0,
            note: job.appeal_resolved
              ? `bond ${job.bond_outcome.replaceAll('_', ' ').toLowerCase()}`
              : job.appeal_replier
                ? 'both parties on the record, awaiting resolution'
                : 'waiting for the other party to answer',
            done: job.appeal_resolved,
          },
        ]
      : []),
    {
      key: 'settled',
      title:
        job.status === 'SETTLED'
          ? 'Escrow settled'
          : job.status === 'STALLED'
            ? 'Escrow refunded'
            : 'Settlement',
      at: job.settled_at,
      note: job.settled_at
        ? job.status === 'STALLED'
          ? 'employer refunded, referral bond returned'
          : 'Balances credited, withdrawable'
        : job.appealed
          ? 'appeal on the record'
          : 'after the appeal window',
      done: job.status === 'SETTLED' || job.status === 'STALLED',
    },
  ]
  return (
    <ol className="timeline">
      {steps.map((step) => (
        <li key={step.key} className={step.done ? 'step done' : 'step'}>
          <span className="step-node" aria-hidden />
          <div className="step-body">
            <div className="step-title">{step.title}</div>
            <div className="step-note">{step.note}</div>
            {step.at ? <div className="step-at mono">{new Date(num(step.at) * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function ApplicationRow({
  app,
  job,
  employerView,
  onReview,
  onHire,
  busy,
}: {
  app: Application
  job: Job
  employerView: boolean
  onReview: () => void
  onHire: () => void
  busy: boolean
}) {
  const canHire =
    employerView &&
    job.status === 'OPEN' &&
    (app.screening === 'ELIGIBLE' || app.screening === 'PARTIAL')
  return (
    <article className="app-row">
      <div className="app-head">
        <div>
          <div className="app-name mono">{short(app.candidate)}</div>
          <div className="app-sub">
            {app.status}
            {app.referrer ? ' · referred by ' + short(app.referrer) : ' · direct'}
          </div>
        </div>
        <div className={`screen screen-${(app.screening || 'none').toLowerCase()}`}>
          {app.screening || 'not reviewed'}
          {app.screening ? <span className="screen-score">{num(app.fit_score)}</span> : null}
        </div>
      </div>
      <p className="app-pitch">{app.pitch}</p>
      <div className="app-meta">
        <span className="mono">{app.skills || 'skills not stated'}</span>
        <a href={app.evidence.split('\n')[0]} target="_blank" rel="noreferrer">
          open evidence
        </a>
      </div>
      {app.screening_notes ? <p className="app-notes">{app.screening_notes}</p> : null}
      {employerView && job.status === 'OPEN' ? (
        <div className="app-actions">
          {!app.screening || app.screening === 'UNVERIFIABLE' ? (
            <Button tone="ghost" onClick={onReview} busy={busy}>
              Review application
            </Button>
          ) : null}
          {canHire ? (
            <Button onClick={onHire} busy={busy}>
              Hire {short(app.candidate)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function ProfileLine({ profile, you }: { profile: Profile; you?: boolean }) {
  return (
    <div className={`profile-line${you ? ' you' : ''}`}>
      <span className="profile-addr mono">{short(profile.account)}</span>
      <span className="profile-score" title="Portico reputation score">
        {num(profile.score)}
      </span>
      <span className="profile-role">
        {num(profile.candidate_jobs)} delivered · {num(profile.referrer_hires)} hires vouched
      </span>
    </div>
  )
}

export function isEmployer(job: Job, account: string | null): boolean {
  return sameAddress(job.employer, account)
}

export function isCandidate(job: Job, account: string | null): boolean {
  return sameAddress(job.candidate, account)
}
