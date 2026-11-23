const STEPS = [
  {
    index: '01',
    title: 'Post and fund',
    body: 'The employer writes the role, the requirements and the acceptance criteria in plain language, chooses who can apply, and funds the whole payout into the contract. Nothing is paid from a private budget later.',
  },
  {
    index: '02',
    title: 'Vouch or apply',
    body: 'A referrer stakes a bond and names one candidate, which is what opens a referral-gated role. In open roles anyone may apply directly, and a referrer can still attach a bounty-bearing vouch.',
  },
  {
    index: '03',
    title: 'Verify',
    body: 'Before a hire, validators read the candidate evidence against the requirements. After delivery, they read the committed artifacts against the acceptance criteria and stamp a ratio: PASS, PARTIAL or FAIL.',
  },
  {
    index: '04',
    title: 'Settle',
    body: 'After the appeal window the escrow splits itself at the stamped ratio: applicant, referrer bounty, protocol fee, and a refund of whatever the work did not earn.',
  },
]

const RULES = [
  ['PASS', 'Every acceptance criterion is evidenced.', 'Pays the full applicant share (100%).'],
  ['PARTIAL', 'The core deliverable exists, at least one criterion is unmet.', 'Ratio is 5–85%, in 5-point steps.'],
  ['FAIL', 'Evidence is absent, unrelated, fabricated, or contradicts the claim.', 'Ratio is 0. Escrow returns to the employer.'],
  ['UNDETERMINED', 'No committed source could be read.', 'No verdict is written; the applicant may repair the evidence.'],
]

const BONDS = [
  {
    title: 'Referral bond',
    body: 'Returned when the role closes, when another candidate is hired, or when the hired applicant delivers. On a FAIL verdict half goes to the employer. If screening finds fabricated evidence, the whole bond goes to the employer and the referrer score drops.',
  },
  {
    title: 'Appeal bond',
    body: 'Five percent of escrow, with a floor. One appeal per dossier, filed by the employer or the applicant. The other party gets a fixed window to file its own answer, and the panel reads both statements. The bond returns only if the verdict moves in the appellant’s favour; otherwise it is paid to the other party.',
  },
  {
    title: 'Unfulfilled hire',
    body: 'If no delivery arrives within the delivery window plus three days, the employer recovers the escrow, the referrer recovers the bond, and the applicant’s passport records a no-show.',
  },
  {
    title: 'Stalled delivery',
    body: 'If no verdict exists seven days after delivery, either party can close the dossier. The employer recovers the escrow, the referrer recovers the bond, and the applicant is recorded as stalled rather than failed. Escrow cannot stay locked forever.',
  },
  {
    title: 'Nobody can redirect it',
    body: 'There is no owner switch over escrow. Settlement writes a withdrawable credit per payee; each payee releases its own balance with withdraw(). The protocol owner can only collect the fee the employer chose.',
  },
]

export default function ProtocolPage() {
  return (
    <div className="page">
      <section className="hero hero-small">
        <div className="hero-eyebrow">
          <span className="rule" /> Mechanics
        </div>
        <h1>
          The judgement is on chain.
          <br />
          The arithmetic is not.
        </h1>
        <p className="hero-copy">
          GenLayer validators settle the parts a deterministic contract cannot: does this person
          clear the door, and does this delivery satisfy the brief. Escrow accounting, bonds,
          deadlines and reputation are deterministic, so consensus never disagrees about numbers.
        </p>
      </section>

      <section className="protocol">
        <div className="protocol-steps">
          {STEPS.map((step) => (
            <article key={step.index} className="protocol-step">
              <span className="step-index mono">{step.index}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>

        <div className="protocol-split">
          <div className="protocol-col">
            <div className="eyebrow">Decided by validators</div>
            <h3>Three judgement calls</h3>
            <ul className="ticks">
              <li>
                <b>Screening.</b> A referred applicant's public evidence is read against the role
                requirements. The verdict decides whether the employer may hire, and fabrication
                slashes the referrer's bond.
              </li>
              <li>
                <b>Delivery.</b> The committed artifacts are read against the acceptance criteria.
                The verdict produces the payout ratio that moves escrow.
              </li>
              <li>
                <b>Appeal.</b> The record is re-read with both authenticated statements on file:
                the appellant's case and the other party's answer. The panel can overturn the prior
                ratio, and the bond follows the outcome.
              </li>
            </ul>
          </div>
          <div className="protocol-col">
            <div className="eyebrow">Decided by code</div>
            <h3>Everything that touches money</h3>
            <ul className="ticks">
              <li>Escrow custody, payout splits and refunds, in integer atto units.</li>
              <li>Referral and appeal bonds, returns, splits and slashes.</li>
              <li>Deadlines, attempt caps, bounded stall refunds and withdrawal balances.</li>
              <li>The reputation score, from stored counters — no model call.</li>
            </ul>
            <div className="formula">
              <div className="formula-line">
                applicant = escrow × applicant_bps × ratio
              </div>
              <div className="formula-line">
                referrer = escrow × referrer_bps × ratio
              </div>
              <div className="formula-line">
                fee = escrow × fee_bps × ratio
              </div>
              <div className="formula-line">
                refund = escrow − applicant − referrer − fee
              </div>
              <div className="formula-note">
                bps are basis points and the ratio is the stamped verdict. Integer division leaves
                the dust with the employer.
              </div>
            </div>
          </div>
        </div>

        <div className="protocol-table">
          <div className="eyebrow">Verdict bands</div>
          <table>
            <thead>
              <tr>
                <th>Verdict</th>
                <th>When validators stamp it</th>
                <th>What escrow does</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map(([verdict, when, effect]) => (
                <tr key={verdict}>
                  <td>
                    <span className={`pill pill-${verdict.toLowerCase()}`}>{verdict}</span>
                  </td>
                  <td>{when}</td>
                  <td>{effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="protocol-bonds">
          <div className="eyebrow">Skin in the game</div>
          {BONDS.map((bond) => (
            <article key={bond.title}>
              <h3>{bond.title}</h3>
              <p>{bond.body}</p>
            </article>
          ))}
        </div>

        <div className="protocol-consensus">
          <div className="eyebrow">Consensus, concretely</div>
          <div className="consensus-grid">
            <div>
              <h3>Independent re-derivation</h3>
              <p>
                Every validator reruns the same evidence read and judgement. The leader's answer is
                accepted only when the validator reaches the same verdict and the exact same payout
                bucket. Ratios are snapped to 5-point steps, so two validators cannot carry a
                10-point difference in what the applicant is paid. A bare schema check would let one
                node decide alone; this contract never does that.
              </p>
            </div>
            <div>
              <h3>Failure classes</h3>
              <p>
                Deterministic contract errors must match exactly. A transient fetch failure agrees
                only with another transient failure. A model misbehaviour always disagrees, which
                forces a new leader instead of locking a broken answer into state.
              </p>
            </div>
            <div>
              <h3>No hidden operator</h3>
              <p>
                The employer cannot release escrow unilaterally, the referrer cannot withdraw a
                bond after a hire, and the protocol owner cannot redirect a payout. The only
                privileged action is the fee parameter set at deployment.
              </p>
            </div>
          </div>
        </div>

        <div className="protocol-deploy">
          <div className="eyebrow">Run it</div>
          <pre>
            <code>{`genlayer network set studionet
genlayer deploy --contract contracts/portico.py \\
  --args 300 50000000000000000 1000000000000000000 10000000000000000

# 300 bps fee · 0.05 GEN referral bond · 1 GEN minimum escrow · 0.01 GEN appeal floor`}</code>
          </pre>
        </div>
      </section>
    </div>
  )
}
