import { useEffect, useState } from 'react'
import { IS_CONFIGURED, read } from './api'
import type { Passport, Profile } from './types'
import { gen, num, short } from './format'
import { Button, Chip, Field, Input, Money, Notice, Panel, Seal, Spinner } from './ui'

export default function PassportPage({
  address,
  account,
  refresh,
  run,
  connect,
}: {
  address: string
  account: string | null
  refresh: number
  run: (fn: string, args: unknown[], value: bigint, label: string) => Promise<unknown>
  connect: () => Promise<boolean>
}) {
  const target = address || account || ''
  const [lookup, setLookup] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [passport, setPassport] = useState<Passport | null>(null)
  const [credit, setCredit] = useState<bigint>(0n)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target || !IS_CONFIGURED) {
      setProfile(null)
      setPassport(null)
      setCredit(0n)
      return
    }
    let live = true
    setError(null)
    Promise.all([
      read<Profile>('get_profile', [target]),
      read<Passport>('get_passport', [target]),
      read<number>('get_credit', [target]),
    ])
      .then(([nextProfile, nextPassport, nextCredit]) => {
        if (!live) return
        setProfile(nextProfile)
        setPassport(nextPassport)
        setCredit(BigInt(nextCredit))
      })
      .catch((err) => {
        if (live) setError(String((err as Error)?.message ?? err))
      })
    return () => {
      live = false
    }
  }, [target, refresh])

  if (!IS_CONFIGURED) return null

  if (!target) {
    return (
      <div className="page">
        <section className="hero hero-small">
          <div className="hero-eyebrow">
            <span className="rule" /> Portable reputation
          </div>
          <h1>Look up a passport.</h1>
          <p className="hero-copy">
            Every applicant and referrer carries a score that is earned from settled dossiers, not
            from a platform's private database. Any contract can read the same attestation.
          </p>
        </section>
        <Panel eyebrow="Lookup" title="Read an address">
          <div className="lookup">
            <Input
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
              placeholder="0x…"
            />
            <Button
              onClick={() => {
                window.location.hash = '/passport/' + lookup.trim()
              }}
              disabled={!/^0x[0-9a-fA-F]{40}$/.test(lookup.trim())}
            >
              Read passport
            </Button>
          </div>
          {account ? (
            <Button tone="quiet" onClick={() => window.location.hash = '/passport/' + account}>
              Use my connected address
            </Button>
          ) : (
            <Button tone="quiet" onClick={() => void connect()}>
              Connect wallet
            </Button>
          )}
        </Panel>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <Notice tone="bad">{error}</Notice>
      </div>
    )
  }
  if (!profile || !passport) return <Spinner label="Reading the passport" />

  const isSelf = Boolean(account) && account?.toLowerCase() === target.toLowerCase()

  return (
    <div className="page">
      <section className="passport">
        <div className="passport-paper">
          <header className="passport-head">
            <div>
              <div className="eyebrow">Portable work passport</div>
              <h1>{short(passport.account)}</h1>
              <div className="passport-id mono">{passport.account}</div>
            </div>
            <Seal verdict={scoreBand(num(passport.score))} status="VERIFIED" small />
          </header>

          <div className="passport-score">
            <div className="score-number">{num(passport.score)}</div>
            <div className="score-meta">
              <div className="score-label">Portico score · 0–1000</div>
              <div className="score-bar">
                <span style={{ width: `${num(passport.score) / 10}%` }} />
              </div>
              <p>
                Smoothed success rate across delivered work and vouched hires, with explicit
                penalties for failed deliveries, no-shows, fabricated evidence and slashed bonds.
              </p>
            </div>
          </div>

          <div className="passport-columns">
            <div>
              <div className="eyebrow">As applicant</div>
              <div className="passport-grid">
                <Field label="Jobs settled" mono>{num(passport.candidate.jobs)}</Field>
                <Field label="Passed" mono>{num(passport.candidate.passes)}</Field>
                <Field label="Partial" mono>{num(passport.candidate.partials)}</Field>
                <Field label="Failed" mono>{num(passport.candidate.fails)}</Field>
                <Field label="No-shows" mono>{num(passport.candidate.no_shows)}</Field>
              </div>
            </div>
            <div>
              <div className="eyebrow">As referrer</div>
              <div className="passport-grid">
                <Field label="Vouches" mono>{num(passport.referrer.referrals)}</Field>
                <Field label="Hired" mono>{num(passport.referrer.hires)}</Field>
                <Field label="Delivered" mono>{num(passport.referrer.successes)}</Field>
                <Field label="Slashed" mono>{num(passport.referrer.slashes)}</Field>
                <Field label="Screened out" mono>{num(passport.screened_out)}</Field>
              </div>
            </div>
          </div>

          <div className="passport-earned">
            <span>Earned on outcome</span>
            <Money value={passport.earned_atto} />
            <span className="passport-credit">
              withdrawable <b>{gen(credit)} GEN</b>
            </span>
          </div>

          <div className="passport-digest">
            <div className="eyebrow">Attestation digest</div>
            <code>{passport.digest}</code>
            <p>
              Computed by the contract from the stored counters. Another application can call{' '}
              <code>get_passport(address)</code> and compare the digest without trusting this page.
            </p>
          </div>
        </div>

        <aside className="passport-side">
          <Panel eyebrow="Wallet" title="What this address can do">
            <div className="facts">
              <Field label="Known to the protocol" mono>
                {profile.known ? 'yes' : 'no settled history'}
              </Field>
              <Field label="Last active" mono>
                {num(profile.last_active)
                  ? new Date(num(profile.last_active) * 1000).toLocaleDateString('en-GB')
                  : '—'}
              </Field>
              <Field label="Withdrawable" mono>
                {gen(credit)} GEN
              </Field>
            </div>
            {isSelf ? (
              <Button
                full
                busy={busy}
                disabled={credit <= 0n}
                onClick={async () => {
                  setBusy(true)
                  await run('withdraw', [], 0n, 'Withdraw')
                  setBusy(false)
                }}
              >
                Withdraw {gen(credit)} GEN
              </Button>
            ) : (
              <p className="muted-copy">Connect this wallet to withdraw its balance.</p>
            )}
          </Panel>

          <Panel eyebrow="Read it" title="Reputation with a receipt">
            <div className="passport-tags">
              <Chip tone="brass">score {num(passport.score)}</Chip>
              <Chip tone="plain">{num(passport.candidate.jobs)} outcomes</Chip>
              <Chip tone="plain">{num(passport.referrer.hires)} vouched hires</Chip>
            </div>
            <p className="muted-copy">
              The digest covers the counters and the score, not the time of reading. A hiring contract
              can require <code>score &gt;= N</code> and verify the digest against the same state.
            </p>
            <div className="passport-note mono">
              protocol {passport.protocol} · v{passport.version}
            </div>
          </Panel>
        </aside>
      </section>
    </div>
  )
}

function scoreBand(score: number): string {
  if (score >= 800) return 'TRUSTED'
  if (score >= 650) return 'PROVEN'
  if (score >= 450) return 'TESTED'
  return 'THIN'
}
