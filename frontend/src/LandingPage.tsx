import { useEffect, useRef, useState } from 'react'
import { CONTRACT, IS_CONFIGURED, read } from './api'
import { atto, gen, num, pct, short } from './format'
import type { Job, Num, Stats, Terms } from './types'
import { navigate } from './router'
import { Seal } from './ui'

type CardData = {
  live: boolean
  id: string
  title: string
  status: string
  verdict: string
  ratio: number
  escrow: string
  applicant: string
  referrer: string
  fee: string
  refund: string
  candidateBps: number
  referrerBps: number
  feeBps: number
}

const SAMPLE: CardData = {
  live: false,
  id: 'J1',
  title: 'SDK documentation engineer — quickstart README',
  status: 'SETTLED',
  verdict: 'PASS',
  ratio: 10_000,
  escrow: '10000000000000000000',
  applicant: '7000000000000000000',
  referrer: '2700000000000000000',
  fee: '300000000000000000',
  refund: '0',
  candidateBps: 7_000,
  referrerBps: 2_700,
  feeBps: 300,
}

function money(value: string | number | bigint | undefined): string {
  const raw = atto(value)
  const whole = raw / 10n ** 18n
  const cents = (raw % 10n ** 18n) / 10n ** 16n
  return `${whole.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')}`
}

function cardOf(job: Job | undefined): CardData {
  if (!job) return SAMPLE
  return {
    live: true,
    id: job.job_id,
    title: job.title,
    status: job.status,
    verdict: job.verdict || job.status,
    ratio: num(job.payout_ratio_bps),
    escrow: String(job.escrow_atto),
    applicant: String(job.candidate_paid_atto),
    referrer: String(job.referrer_paid_atto),
    fee: String(job.fee_paid_atto),
    refund: String(job.employer_refund_atto),
    candidateBps: num(job.candidate_bps),
    referrerBps: num(job.referrer_bps),
    feeBps: num(job.fee_bps),
  }
}

function useLandingData() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [terms, setTerms] = useState<Terms | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  useEffect(() => {
    if (!IS_CONFIGURED) return
    let live = true
    // Settle each read on its own: one throttled call must not blank the whole
    // hero when the other two answered.
    Promise.allSettled([
      read<Stats>('get_stats'),
      read<Terms>('get_terms'),
      read<Job[]>('list_jobs', [0, 6]),
    ]).then(([nextStats, nextTerms, nextJobs]) => {
      if (!live) return
      if (nextStats.status === 'fulfilled') setStats(nextStats.value)
      if (nextTerms.status === 'fulfilled') setTerms(nextTerms.value)
      if (nextJobs.status === 'fulfilled') setJobs(nextJobs.value)
    })
    return () => {
      live = false
    }
  }, [])
  return { stats, terms, jobs }
}

function useCountUp(target: number) {
  const [value, setValue] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || target === 0) {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1100)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(target * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return { value, ref }
}

function LiveGen({ atto }: { atto: Num | undefined }) {
  const target = atto === undefined ? 0 : Number(atto) / 1e18
  const { value, ref } = useCountUp(target)
  if (atto === undefined) return <span className="l-stat-num">—</span>
  const text = value >= 100 ? value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : value.toFixed(2)
  return (
    <span className="l-stat-num" ref={ref}>
      {text}
      <i>GEN</i>
    </span>
  )
}

function LandingNav({ scrolled, progress }: { scrolled: boolean; progress: number }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const closeMenu = () => {
    if (menu.current) menu.current.open = false
  }

  return (
    <header className={`l-nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="l-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />
      <button className="l-brand" onClick={() => navigate('/')} aria-label="Portico home">
        <img src="/seal.svg" alt="" width={34} height={34} />
        <span>
          <b>Portico</b>
          <small>access by referral</small>
        </span>
      </button>

      <nav className="l-links" aria-label="On this page">
        <a href="#how">How it works</a>
        <a href="#judgement">The judgement</a>
        <a href="#verdicts">Verdicts</a>
      </nav>

      <div className="l-nav-actions">
        <button className="l-ghost" onClick={() => navigate('/protocol')}>
          Protocol <span aria-hidden>↗</span>
        </button>
        <button className="l-ghost" onClick={() => navigate('/passport')}>
          Passport <span aria-hidden>↗</span>
        </button>
        <button className="l-cta" onClick={() => navigate('/board')}>
          Open the board <span aria-hidden>→</span>
        </button>
        <details className="l-menu" ref={menu}>
          <summary aria-label="Open menu">Menu</summary>
          <div className="l-menu-sheet">
            <button onClick={() => { closeMenu(); navigate('/board') }}>Open the board</button>
            <a href="#how" onClick={closeMenu}>
              How it works
            </a>
            <a href="#judgement" onClick={closeMenu}>
              The judgement
            </a>
            <a href="#verdicts" onClick={closeMenu}>
              Verdicts
            </a>
            <button onClick={() => { closeMenu(); navigate('/protocol') }}>Protocol</button>
            <button onClick={() => { closeMenu(); navigate('/passport') }}>Passport</button>
          </div>
        </details>
      </div>
    </header>
  )
}

function HeroCard({ card }: { card: CardData }) {
  const ref = useRef<HTMLDivElement>(null)
  const effective = (bps: number) => Math.round((bps * card.ratio) / 10_000)
  const parts = [
    { label: 'Applicant', bps: effective(card.candidateBps), amount: card.applicant, tone: 'seal' },
    { label: 'Referrer', bps: effective(card.referrerBps), amount: card.referrer, tone: 'brass' },
    { label: 'Fee', bps: effective(card.feeBps), amount: card.fee, tone: 'ink' },
  ]
  const used = parts.reduce((sum, part) => sum + part.bps, 0)
  const refundBps = Math.max(0, 10_000 - used)

  function move(event: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    const rect = el.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    el.style.setProperty('--ry', `${x * 7}deg`)
    el.style.setProperty('--rx', `${-y * 7}deg`)
  }

  function leave() {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--ry', '0deg')
    el.style.setProperty('--rx', '0deg')
  }

  return (
    <div className="l-card-wrap">
      <div className="l-card-halo" aria-hidden />
      <div className="l-card" ref={ref} onPointerMove={move} onPointerLeave={leave}>
        <div className="l-card-top">
          <span className={`l-live${card.live ? '' : ' is-sample'}`}>
            <i /> {card.live ? 'Live dossier' : 'Sample dossier'}
          </span>
          <span className="l-card-id mono">{card.id} · {card.status}</span>
        </div>

        <div className="l-card-body">
          <div className="l-card-copy">
            <h2>{card.title}</h2>
            <div className="l-card-tags">
              <span>Referral only</span>
              <span>Score 500+</span>
              <span>Escrow {gen(card.escrow)} GEN</span>
            </div>
          </div>
          <div className="l-card-seal">
            <Seal verdict={card.verdict} />
          </div>
        </div>

        <div className="l-split" aria-label="Settlement split">
          {parts.map((part) => (
            <span
              key={part.label}
              className={`l-split-seg is-${part.tone}`}
              style={{ width: `${part.bps / 100}%` }}
            />
          ))}
          {refundBps > 0 ? <span className="l-split-refund" style={{ width: `${refundBps / 100}%` }} /> : null}
        </div>

        <div className="l-card-legend">
          {parts.map((part) => (
            <span key={part.label} className={`l-legend is-${part.tone}`}>
              <i /> {part.label} <b>{pct(part.bps)}</b>
              <em>{money(part.amount)} GEN</em>
            </span>
          ))}
        </div>

        <div className="l-card-verdict">
          <span className={`l-verdict-word is-${card.verdict.toLowerCase()}`}>{card.verdict}</span>
          <span className="l-verdict-ratio">{card.ratio ? pct(card.ratio) : '—'}</span>
          <span className="l-verdict-note">
            {card.ratio ? 'of the funded split' : 'not adjudicated yet'}
          </span>
        </div>

        <div className="l-card-foot">
          <span>Escrow in = credits out</span>
          <span className="mono">settled on studionet</span>
        </div>
        <div className="l-card-sheen" aria-hidden />
      </div>
    </div>
  )
}

const STEPS = [
  {
    num: '01',
    meta: 'employer',
    title: 'Post and fund',
    body: 'Write the role and the acceptance criteria in plain language, then fund the whole payout into the contract. Nothing is paid from a private budget later.',
    tag: 'Escrow funded',
  },
  {
    num: '02',
    meta: 'referrer / applicant',
    title: 'Vouch or apply',
    body: 'A referrer stakes a bond to open a referral-gated role. The applicant commits public evidence the panel can actually fetch.',
    tag: 'Bond locked',
  },
  {
    num: '03',
    meta: 'validators',
    title: 'Verify',
    body: 'Validators read the sources and judge screening, delivery and any appeal independently. The leader cannot invent a verdict the validator does not reach.',
    tag: 'Evidence fetched',
  },
  {
    num: '04',
    meta: 'contract',
    title: 'Settle',
    body: 'The exact ratio splits escrow. Credits are written once, and each payee releases its own balance. No approval step, no operator key.',
    tag: 'Credits written',
  },
]

const JUDGEMENTS = [
  {
    num: '01',
    title: 'Screening',
    body: 'A referred applicant\'s public evidence is read against the role. ELIGIBLE and PARTIAL are the same hire gate; FRAUD is different because it moves the referrer\'s bond.',
    out: 'QUALIFIED',
    outNote: 'gate decision',
  },
  {
    num: '02',
    title: 'Delivery',
    body: 'The delivered work is read against the written criteria. A pass pays in full; a partial pays a 5-point bucket. The validator must agree on the exact value.',
    out: 'PASS · 100%',
    outNote: 'exact buckets',
  },
  {
    num: '03',
    title: 'Appeal',
    body: 'One bonded appeal, filed by either party. The other side gets a fixed window to answer, and the panel re-reads the record with both cases on file.',
    out: '2 CASES',
    outNote: 'both authenticated',
  },
]

const BANDS = [
  {
    word: 'PASS',
    tone: 'pass',
    when: 'Every acceptance criterion is evidenced.',
    pays: '100% of the applicant share',
  },
  {
    word: 'PARTIAL',
    tone: 'partial',
    when: 'The core deliverable exists; at least one criterion is unmet.',
    pays: '5–85%, in 5-point buckets',
  },
  {
    word: 'FAIL',
    tone: 'fail',
    when: 'Absent, unrelated, fabricated, or contradicted.',
    pays: '0. The employer is refunded.',
  },
  {
    word: 'UNDETERMINED',
    tone: 'undetermined',
    when: 'No committed source could be read.',
    pays: 'Retry, then a stall refund',
  },
]

export default function LandingPage() {
  const { stats, terms, jobs } = useLandingData()
  const [scrolled, setScrolled] = useState(false)
  const [progress, setProgress] = useState(0)
  const featured = jobs.find((job) => job.status === 'SETTLED') ?? jobs[0]
  const card = cardOf(featured)
  const credited = [card.applicant, card.referrer, card.fee, card.refund].reduce(
    (sum, value) => sum + atto(value),
    0n,
  )

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 14)
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in')
            io.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className={scrolled ? 'landing is-scrolled' : 'landing'}>
      <div className="l-bg" aria-hidden>
        <div className="l-aurora l-aurora-a" />
        <div className="l-aurora l-aurora-b" />
        <div className="l-aurora l-aurora-c" />
        <div className="l-grid" />
        <div className="l-noise" />
      </div>

      <LandingNav scrolled={scrolled} progress={progress} />
      <div className="l-topshade" aria-hidden />

      <main className="l-main">
        <section className="l-hero" id="top">
          <div className="l-hero-copy">
            <div className="l-eyebrow">
              <span className="l-pulse" /> Referral-gated hiring · settled by GenLayer
            </div>
            <h1>
              The door opens by referral.
              <br />
              The money moves by <em>proof.</em>
            </h1>
            <p className="l-lede">
              Portico holds the whole hire in escrow. A referrer stakes a bond to open access.
              GenLayer validators read the applicant's evidence and the delivered work, independently,
              then stamp a verdict. The applicant, the referrer and the protocol are paid from that
              stamp — not from an operator's approval.
            </p>
            <div className="l-hero-actions">
              <button className="l-btn l-btn-primary" onClick={() => navigate('/board')}>
                Open the board <span aria-hidden>→</span>
              </button>
              <a className="l-btn l-btn-glass" href="#how">
                See how it settles
              </a>
            </div>
            <div className="l-stat-row">
              <div className="l-stat">
                <span className="l-stat-label">In escrow</span>
                <LiveGen atto={stats?.escrowed_atto} />
              </div>
              <div className="l-stat">
                <span className="l-stat-label">Paid on outcome</span>
                <LiveGen atto={stats?.paid_out_atto} />
              </div>
              <div className="l-stat">
                <span className="l-stat-label">Dossiers settled</span>
                <span className="l-stat-num">
                  {stats ? num(stats.jobs_settled) : '—'}
                  <i>of {stats ? num(stats.jobs_posted) : '—'}</i>
                </span>
              </div>
              <div className="l-stat">
                <span className="l-stat-label">Protocol fee</span>
                <span className="l-stat-num">
                  {terms ? num(terms.fee_bps) / 100 : '—'}
                  <i>%</i>
                </span>
              </div>
            </div>
            <div className="l-trust">
              <span className="l-dot" /> Live on GenLayer Studionet
              <span className="l-sep" />
              64 contract tests
              <span className="l-sep" />
              No operator key
            </div>
          </div>

          <div className="l-hero-visual">
            <HeroCard card={card} />
          </div>
        </section>

        <div className="l-ticker" aria-hidden>
          {[0, 1].map((copy) => (
            <div className="l-ticker-track" key={copy}>
              {[
                'Screened by consensus',
                'Paid on outcome',
                'Referral bonds',
                'Exact payout buckets',
                'Authenticated appeals',
                'Bounded refunds',
                'Portable reputation',
                'No private budget',
              ].map((item) => (
                <span key={item}>
                  {item} <b>◆</b>
                </span>
              ))}
            </div>
          ))}
        </div>

        <section className="l-section" id="how">
          <div className="l-section-head" data-reveal>
            <div className="l-eyebrow">How it works</div>
            <h2>Four moves. No approval step.</h2>
            <p>
              The employer funds the whole payout before the role opens. Every later move is either
              a stored fact or a validator judgement — never a private decision about whether to pay.
            </p>
          </div>

          <div className="l-steps">
            {STEPS.map((step, index) => (
              <article
                className="l-step"
                key={step.num}
                data-reveal
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <div className="l-step-top">
                  <span className="l-step-num">{step.num}</span>
                  <span className="l-step-meta">{step.meta}</span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <div className="l-step-foot">
                  <span>{step.tag}</span>
                  <i aria-hidden>↗</i>
                </div>
              </article>
            ))}
          </div>

          <div className="l-how-note" data-reveal>
            <span className="l-note-mark">!</span>
            <p>
              If no verdict lands within seven days of delivery, either party can close the dossier:
              the employer is refunded, the referrer's bond comes back, and the applicant is recorded
              as stalled — not failed. Escrow cannot sit locked forever.
            </p>
            <button onClick={() => navigate('/protocol')}>Read the state machine →</button>
          </div>
        </section>

        <section className="l-section l-judgement" id="judgement">
          <div className="l-judgement-intro" data-reveal>
            <div className="l-eyebrow">The judgement</div>
            <h2>Three calls belong to validators. The rest belongs to code.</h2>
            <p>
              Validators never touch the arithmetic. The contract never guesses. Each judgement is
              fetched, re-derived by an independent validator, and reduced to a value the escrow can
              pay against.
            </p>
            <div className="l-judgement-stamp">
              <span>Work verified by consensus</span>
              <span>Paid on outcome</span>
            </div>
          </div>

          <div className="l-judge-list">
            {JUDGEMENTS.map((item, index) => (
              <article
                className="l-judge"
                key={item.title}
                data-reveal
                style={{ transitionDelay: `${index * 70}ms` }}
              >
                <span className="l-judge-index">{item.num}</span>
                <div className="l-judge-copy">
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
                <div className="l-judge-out">
                  <span>{item.out}</span>
                  <small>{item.outNote}</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="l-section" id="money">
          <div className="l-money" data-reveal>
            <div className="l-money-copy">
              <div className="l-eyebrow">The arithmetic</div>
              <h2>The money is boring. That is the feature.</h2>
              <p>
                Escrow, bonds, fees and refunds are integer atto arithmetic outside every
                non-deterministic block. The verdict decides one ratio; the contract does the rest.
              </p>
              <div className="l-money-facts">
                {['No operator key', 'Exact 5-point buckets', 'Pull payments', 'Bounded refunds'].map(
                  (fact) => (
                    <span key={fact}>
                      <i aria-hidden>✓</i> {fact}
                    </span>
                  ),
                )}
              </div>
              <div className="l-formula">
                <span className="l-formula-label">How one share is derived</span>
                <span>applicant = escrow × candidate_bps × ratio</span>
                <span>referrer = escrow × referrer_bps × ratio</span>
                <span>fee = escrow × fee_bps · refund = escrow − shares</span>
              </div>
            </div>

            <div className="l-ledger">
              <div className="l-ledger-head">
                <span>Dossier {card.id}</span>
                <span className="mono">GEN</span>
              </div>
              <div className="l-ledger-row">
                <span>Funded escrow</span>
                <b>{money(card.escrow)} GEN</b>
              </div>
              <div className="l-ledger-rule" />
              {[
                ['Applicant', card.applicant],
                ['Referrer', card.referrer],
                ['Protocol fee', card.fee],
                ['Employer refund', card.refund],
              ].map(([label, value]) => (
                <div className="l-ledger-row" key={label}>
                  <span>{label}</span>
                  <b>{money(value)} GEN</b>
                </div>
              ))}
              <div className="l-ledger-rule" />
              <div className="l-ledger-row is-total">
                <span>Credited</span>
                <b>{money(credited)} GEN</b>
              </div>
              <div className="l-ledger-note">escrow in = credits out · no private budget</div>
            </div>
          </div>
        </section>

        <section className="l-section" id="board">
          <div className="l-section-head l-section-head-row" data-reveal>
            <div>
              <div className="l-eyebrow">The board</div>
              <h2>Every dossier is a real escrow.</h2>
            </div>
            <button className="l-link-btn" onClick={() => navigate('/board')}>
              Open the board <span aria-hidden>→</span>
            </button>
          </div>

          <div className="l-board-rows" data-reveal>
            <div className="l-board-head">
              <span>Dossier</span>
              <span>Role</span>
              <span>Status</span>
              <span>Verdict</span>
              <span>Escrow</span>
            </div>
            {jobs.length ? (
              jobs.map((job) => (
                <button
                  className="l-board-row"
                  key={job.job_id}
                  onClick={() => navigate('/job/' + job.job_id)}
                >
                  <span className="l-board-id mono">{job.job_id}</span>
                  <span className="l-board-title">{job.title}</span>
                  <span className={`l-board-status is-${job.status.toLowerCase()}`}>
                    {job.status}
                  </span>
                  <span className="l-board-verdict">
                    {job.verdict ? `${job.verdict} · ${pct(job.payout_ratio_bps)}` : 'open'}
                  </span>
                  <span className="l-board-amount mono">{money(job.escrow_atto)} GEN</span>
                </button>
              ))
            ) : (
              <div className="l-board-empty">
                <span>No dossiers on this contract yet.</span>
                <button onClick={() => navigate('/board')}>Post the first role →</button>
              </div>
            )}
            <div className="l-board-foot">
              <span>Live read of the deployment · the board fills as roles are posted</span>
              <span className="mono">{IS_CONFIGURED ? short(CONTRACT) : 'not configured'}</span>
            </div>
          </div>
        </section>

        <section className="l-section" id="verdicts">
          <div className="l-section-head" data-reveal>
            <div className="l-eyebrow">Verdict bands</div>
            <h2>The stamp is the payment instruction.</h2>
            <p>
              A pass pays in full. A partial pays a consensus bucket. A fail pays nothing. The bands
              are enforced in code, so no caller can turn one into another.
            </p>
          </div>

          <div className="l-bands">
            {BANDS.map((band, index) => (
              <article
                className={`l-band is-${band.tone}`}
                key={band.word}
                data-reveal
                style={{ transitionDelay: `${index * 60}ms` }}
              >
                <span className="l-band-word">{band.word}</span>
                <span className="l-band-when">{band.when}</span>
                <span className="l-band-pays">{band.pays}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="l-final" data-reveal>
          <div className="l-final-glow" aria-hidden />
          <div className="l-eyebrow">Put a role on the board</div>
          <h2>
            Hire on proof,<br /> not on permission.
          </h2>
          <p>
            Fund the outcome once. Let a bond open the door, let validators read the work, and let
            the contract pay the people who earned it.
          </p>
          <div className="l-final-actions">
            <button className="l-btn l-btn-primary" onClick={() => navigate('/board')}>
              Open the board <span aria-hidden>→</span>
            </button>
            <button className="l-btn l-btn-glass" onClick={() => navigate('/protocol')}>
              Read the protocol
            </button>
          </div>
        </section>

        <footer className="l-footer">
          <div className="l-footer-brand">
            <img src="/seal.svg" alt="" width={30} height={30} />
            <span>
              <b>Portico</b>
              <small>access by referral</small>
            </span>
          </div>
          <div className="l-footer-cols">
            <div>
              <span className="l-footer-label">Product</span>
              <button onClick={() => navigate('/board')}>Board</button>
              <button onClick={() => navigate('/passport')}>Passport</button>
              <button onClick={() => navigate('/protocol')}>Protocol</button>
            </div>
            <div>
              <span className="l-footer-label">Network</span>
              <span>GenLayer Studionet</span>
              <span className="mono">chain 61999</span>
            </div>
            <div>
              <span className="l-footer-label">Contract</span>
              <span className="mono">{IS_CONFIGURED ? short(CONTRACT) : 'not configured'}</span>
              <span>64 direct-mode tests</span>
            </div>
          </div>
          <div className="l-footer-bottom">
            <span>An intelligent contract on GenLayer</span>
            <span>Escrow in = credits out</span>
          </div>
        </footer>
      </main>
    </div>
  )
}
