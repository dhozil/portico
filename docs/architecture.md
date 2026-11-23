# Portico — architecture

This note is the engineering record for `contracts/portico.py`. It covers the state machine, the
storage layout, the three non-deterministic blocks, the money invariants, the threat model, and the
evidence from the live consensus run.

## 1. Boundary

Portico is one intelligent contract plus a read/write frontend. It deliberately has no backend, no
indexer, and no operator service. The contract answers three questions and keeps the books; it does
not store résumés, run an interview, or pretend to be a payroll system.

| Concern | Owner |
| --- | --- |
| Wallet session, forms, previews, cached reads, transaction progress | Frontend |
| Escrow custody, bonds, deadlines, payout splits, reputation, credits | Contract (deterministic) |
| Applicant eligibility, delivery quality, appeal outcome | Validators (non-deterministic) |
| The evidence itself | External URLs, fetched but never trusted as instructions |

The unit of work is one scoped engagement with written acceptance criteria. That is the largest unit
a referrer can responsibly put a bond behind, and the smallest unit validators can judge from
committed evidence.

## 2. Roles and authority

| Role | Can do | Cannot do |
| --- | --- | --- |
| Employer | Post and fund, review, hire, cancel before hire, claim an unfulfilled refund, appeal, settle | Release escrow unilaterally, hire an unscreened applicant, refer a candidate |
| Referrer | Stake a bond for one candidate per role, earn the bounty | Refer itself, refer the employer, withdraw the bond after a hire |
| Applicant | Apply, withdraw before review, deliver, repair evidence, appeal, collect | Apply twice, deliver after the deadline, deliver for another applicant |
| Anyone | Adjudicate a delivery, resolve an appeal after both cases, settle after the window, expire a stale role | Move funds, change terms, rewrite a verdict |
| Either party | Answer an appeal within the window, recover a stalled escrow after the grace | Answer its own appeal, recover another dossier |
| Protocol owner | Collect the fee the employer chose | Redirect escrow, pause settlement, change a payout |

## 3. State machine

| From | Method | Guard | To | Effects |
| --- | --- | --- | --- | --- |
| — | `post_job` (payable) | escrow ≥ minimum, split sums to 10,000, referral role has a bounty, bounds valid | `OPEN` | Escrow held, deadlines set |
| `OPEN` | `refer` (payable) | exact bond, referrer ≠ candidate/employer, score gate, caps | `OPEN` | Referral `PENDING`, bond locked |
| `OPEN` | `apply` | window open, no duplicate, valid URLs, referral present for gated roles | `OPEN` | Application `PENDING` |
| `OPEN` | `withdraw_application` | not yet reviewed | `OPEN` | Application `WITHDRAWN` |
| `OPEN` | `review_application` | employer only, not final, attempts < 3 | `OPEN` | Screening verdict stored; `FRAUD` rejects the application and slashes the bond |
| `OPEN` | `hire` | employer only, screening `ELIGIBLE`/`PARTIAL`, referral gate still satisfied | `HIRED` | Winning referral `SELECTED`, other bonds returned, other applications `REJECTED`, delivery clock starts |
| `OPEN` | `cancel_job` | employer only | `CANCELLED` | Escrow and all bonds returned |
| `OPEN` | `expire_job` | past `apply_by` | `EXPIRED` | Escrow and all bonds returned |
| `HIRED` | `submit_work` | applicant only, before `deliver_by`, valid URLs | `DELIVERED` | Submission stored |
| `HIRED` | `refund_unfulfilled` | employer only, past `deliver_by + 3d` | `UNFULFILLED` | Escrow refunded, bond returned, applicant records a no-show |
| `DELIVERED` | `adjudicate` | attempts < 4 | `VERDICT` or stays `DELIVERED` | Verdict, exact ratio bucket, rationale and fetched citations stored; appeal window opens |
| `DELIVERED` | `resubmit_work` | applicant only, within the repair window | `DELIVERED` | Evidence replaced before a verdict |
| `DELIVERED` | `recover_stalled_escrow` | employer or applicant, 7 days after delivery, no verdict | `STALLED` | Escrow refunded, referral bond returned, applicant recorded as stalled |
| `VERDICT` | `appeal` (payable) | employer or applicant, inside the window, exact bond | `APPEALED` | Prior ratio snapshotted; two-day answer window opens |
| `APPEALED` | `reply_to_appeal` | the non-appellant party, once, inside the answer window | `APPEALED` | The other authenticated case is stored |
| `APPEALED` | `resolve_appeal` | anyone; requires an answer on file or the answer window closed | `VERDICT` | New ratio and verdict; appeal bond returned or forfeited; settlement unlocked |
| `VERDICT` | `settle` | window closed or appeal resolved | `SETTLED` | Credits written, referral bond resolved, profiles updated |

Every `OPEN`/`HIRED`/`DELIVERED` exit returns bonds to their owners. There is no path that strands
value: unreadable evidence is capped, repairable during the maintenance window, and recoverable after
the seven-day stall grace.

## 4. Storage layout

```
owner, fee_bps, min_escrow_atto, min_referral_bond_atto, min_appeal_bond_atto

jobs:      TreeMap[str, Job]          job_ids: DynArray[str]        job_seq
applications: TreeMap[str, Application]
           application_ids: DynArray[str]
           app_of: TreeMap["job|candidate", app_id]
           job_apps: TreeMap[job_id, csv(app_id)]
referrals: TreeMap[str, Referral]
           referral_ids: DynArray[str]
           ref_of: TreeMap["job|candidate", referral_id]
           job_refs: TreeMap[job_id, csv(referral_id)]
           ref_count: TreeMap["ref|job|referrer", count]
profiles:  TreeMap[address, Profile]
credits:   TreeMap[address, u256]
ledger:    TreeMap[str, LedgerEntry]
           ledger_ids: DynArray[str]
           job_ledger: TreeMap[job_id, csv(entry_id)]
stats:     TreeMap[str, u256]
```

Design choices:

- **No nested containers.** Per-job indexes are comma-joined id strings, rebuilt with a small splitter
  and capped at 50 applications / 25 referrals. This avoids storing `DynArray` inside `TreeMap`,
  which keeps the layout simple and the reads cheap.
- **Addresses are checksummed hex strings.** `_addr()` normalizes every input, so comparison and
  `TreeMap` keys are canonical.
- **All money is `u256` atto.** No floats anywhere; the linter enforces that.
- **The ledger is append-only.** Settlement never edits a past entry; corrections are new entries.

## 5. Non-deterministic design

All three blocks follow the same shape: build the prompt from storage in the deterministic context,
fetch and judge inside the block, then write state only after consensus returns.

### Screening

Inputs: job brief, requirements, candidate pitch/skills, up to four evidence URLs, referral note and
referrer score.

Output: `verdict`, `fit_score`, `evidence_quality`, `notes`, `cited_sources`, `evidence_status`,
`evidence_digests`.

Validator rule:

```python
return screen_gate(leader.verdict) == screen_gate(validator.verdict)
# screen_gate: ELIGIBLE and PARTIAL -> QUALIFIED; everything else -> itself
```

`ELIGIBLE` and `PARTIAL` are two shades of the same hire gate and pay identically, so they may
differ. `INELIGIBLE`, `FRAUD` and `UNVERIFIABLE` are materially different and must match exactly.
The advisory fit score is stored for the passport but never gates consensus. A positive screening
that cites no fetched URL is downgraded to `UNVERIFIABLE` and the attempt is voided.

`FRAUD` is only reachable when the sources clearly show deception; the prompt says thin evidence is
not fraud. That distinction matters because fraud moves the bond and the score.

### Delivery

Inputs: job brief, acceptance criteria, delivery summary, evidence URLs.

Output: `verdict`, `ratio`, `confidence_pct`, `rationale`, `cited_sources`, `evidence_status`.

Deterministic normalization after the model answers:

- `PASS` → ratio is exactly `10_000`; a pass means every criterion is evidenced, so it cannot pay 95%
- `PARTIAL` → a zero ratio becomes `FAIL`; otherwise the ratio is snapped to a 500 bps bucket in
  `[500, 8500]`
- `FAIL` / `UNDETERMINED` → ratio `0`
- citations are filtered to URLs the block actually fetched; a positive verdict with no citation is
  voided to `UNDETERMINED`

Validator rule: the same verdict and the **exact same bucketed ratio**. There is no tolerance band on
money. Two validators cannot disagree about the percentage while still passing, which is what a
1,000 bps tolerance allowed.

### Appeal

Same evidence, plus the prior verdict, the appellant's statement and the counterparty's answer. Both
statements are labelled untrusted argument, not evidence. The prompt instructs the panel to re-derive
rather than defer. The validator requires the same verdict and the exact same bucketed ratio.

Bond outcome is deterministic:

```
appellant == applicant and new_ratio > prior_ratio  -> returned
appellant == employer  and new_ratio < prior_ratio  -> returned
otherwise                                           -> paid to the counterparty
```

The other party has a fixed two-day window to answer. `resolve_appeal` refuses to run before both
cases are on file or that window has closed, so a party cannot file an appeal and immediately lock an
outcome while the other side is still unheard. If the panel cannot read the record at all, the prior
verdict stands, the bond is returned, and settlement is unlocked. That is the only outcome that
avoids a permanent deadlock.

### Error classes

| Prefix | Meaning | Validator behaviour |
| --- | --- | --- |
| `[EXPECTED]` | Business rule | Exact message match |
| `[EXTERNAL]` | 4xx from a source | Exact match |
| `[TRANSIENT]` | Network / 5xx / model down | Agree only with another transient failure |
| `[LLM_ERROR]` | Model returned an unusable answer | Always disagree — force a new leader |

`_handle_leader_error` implements this. It is why an LLM failure cannot become state.

## 6. Money invariants

```
applicant = escrow × applicant_bps × ratio / 1e8
referrer  = escrow × referrer_bps  × ratio / 1e8
fee       = escrow × fee_bps       × ratio / 1e8
refund    = escrow − applicant − referrer − fee
```

Invariants asserted by the test suite:

1. **Conservation.** Every settlement credits exactly `escrow + referral_bond` (plus the appeal bond
   when one was posted) across the ledger. Nothing is minted, nothing is burned. The direct-mode
   suite sums the ledger and the payee credits and asserts they match.
2. **Single settlement.** `settle` requires `VERDICT`; the transition to `SETTLED` is final. A
   `STALLED` recovery is a separate transition and cannot run after a verdict.
3. **Bond custody.** A bond is either returned, split, or paid to the employer/counterparty. It is
   never left in the contract after the dossier closes.
4. **Bounded lock.** No verdict seven days after delivery opens `recover_stalled_escrow` to either
   party: the employer is refunded, the bond is returned, no fee is charged, and the applicant is not
   marked as failed.
5. **No double credit.** Withdrawal zeroes the credit before emitting the transfer, so a repeated
   `withdraw` cannot pay twice.
6. **Caps.** `PASS` pays exactly 100%; `PARTIAL` cannot pay like a pass; `FAIL` pays nothing.

The referral bond waterfall on a failed delivery is `50% employer / 50% referrer`, because the
referrer vouched for the candidate but the candidate did deliver. Fabricated evidence at screening is
different: 100% to the employer.

## 7. Reputation

```
good     = 2 × passes + partials + 2 × referrer_successes
possible = 2 × (candidate_jobs + referrer_hires)
base     = 200 + 600 × (good + 1) ÷ (possible + 2)
score    = clamp(base + min(80, 4 × possible) − 50 × misses, 0, 1000)
misses   = fails + 2 × no_shows + 2 × referrer_slashes + screened_out
```

A clean address starts at 500. The `+1 / +2` smoothing keeps a single outcome from defining a
history; the experience bonus rewards volume; the penalty is explicit and visible. The passport digest
is `sha256(canonical_json(payload))` over the counters and score, so another application can verify
that the passport it reads is the one the contract holds.

## 8. Threat model

| Attack | Mitigation |
| --- | --- |
| Employer refuses to pay after good work | Consensus settles and credits the applicant; the employer cannot release or block escrow |
| Applicant submits nothing | Employer refunds after `deliver_by + 3d`; the passport records a no-show |
| Applicant games the adjudicator with prompt injection | Evidence is wrapped as untrusted and the prompt says to ignore instructions; the validator reruns the judgement independently |
| Referrer spams fake candidates | Bond per referral, per-referrer cap, score gate, and a fraud path that pays the bond to the employer |
| Referrer and applicant collude on fabricated evidence | Screening must find the deception for the bond to move; a fabricated delivery still fails and the referrer loses half the bond |
| Candidate applies to a gated role without access | `apply` requires a referral whose referrer still meets the score gate |
| Employer hires an unvetted candidate | `hire` requires a final `ELIGIBLE`/`PARTIAL` screening |
| Losing party refuses to accept the verdict | One bonded appeal; settlement is permissionless after the window |
| Leader returns a self-serving verdict | Validators rerun the task and compare the decision fields; leader-only schema checks are never used |
| LLM returns malformed JSON | `_parse_json` strips wrapping text and trailing commas; unusable answers raise `[LLM_ERROR]` and force rotation |
| Recipient contract reverts on payment | Settlement credits an internal balance; withdrawal is a pull and cannot block anyone else |
| Outbound transfer fails after a credit is cleared | Payees are EOAs; a native value transfer to an EOA cannot revert. GenLayer does not expose a bounce callback to the contract, so the design deliberately keeps payees as EOAs and does not promise recovery for a contract payee |
| Reentrancy through value transfer | Credits are zeroed before `emit_transfer`; no external call happens inside a state update |

## 9. Limits and trade-offs

- **One engagement, not a payroll.** Multi-milestone employment would need a milestone array and a
  per-milestone verdict. That is a deliberate scope cut, not an oversight.
- **Evidence is public.** The contract stores URLs, not content. Private documents would need
  encrypted blobs and a validator-accessible key, which changes the trust model.
- **LLM cost is real.** Screening and adjudication are paid by the caller. The attempt caps bound the
  worst case but not the price of a single call.
- **Reputation is not identity.** Sybil resistance is economic (bonds + history), not biometric.
- **Appeals use the same record.** New evidence cannot be introduced on appeal, which prevents
  evidence-swapping after seeing the verdict but also limits genuinely new facts. Both parties may
  argue from that record; neither can add to it.

## 10. Verification

### Direct mode

```
$ python -m pytest tests/ -q
64 passed
```

The suite exercises the full lifecycle, every money path, every guard, validator acceptance and
rejection, reputation and passport stability.

### Live consensus on Studionet

Deployed with `300` bps fee, `0.05 GEN` referral bond, `1 GEN` minimum escrow and `0.01 GEN` appeal
floor at `0x5aC11FD294a0E883a30802FAE20c8F148D975193`. The scripted run drove one dossier through
the full lifecycle with real web reads and real model calls:

| Stage | Transaction | Result |
| --- | --- | --- |
| deploy | `0xd519492d…ed5b` | contract created |
| `post_job` | `0x2be9cf24…` | `J1`, 10 GEN funded, referral-gated, 7-day window |
| `refer` | `0x2790ac9e…` | `R1`, 0.05 GEN bond locked for the applicant |
| `apply` | `0x786b3226…` | `A1` filed with two evidence URLs |
| `review_application` | `0xbf8cbd12…` | `ELIGIBLE`, fit 100, citing the fetched README |
| `hire` | `0x58381c00…` | `HIRED`, bond selected, 14-day delivery clock |
| `submit_work` | `0xb5329c48…` | `DELIVERED` with the raw README |
| `adjudicate` | `0x9c2e05de…` | `PASS` at exactly 10,000 bps |
| `appeal` | `0x16ba5b79…` | employer bonded 0.5 GEN, arguing the `readContract` example is unusable |
| `reply_to_appeal` | `0x17ee63cd…` | the applicant filed its authenticated answer |
| `resolve_appeal` (round 1) | `0x56699b3c…` | no verdict reached; the client saw `UNDETERMINED` and the state stayed `APPEALED` |
| `resolve_appeal` (round 2) | `0xdbb97ba4…` | `PASS` upheld; the employer's bond forfeited to the applicant |
| `settle` | `0x7e43d91f…` | `SETTLED` |

Final ledger for `J1` (escrow 10 GEN plus a 0.5 GEN appeal bond):

| Entry | Recipient | Role | Amount |
| --- | --- | --- | --- |
| L1 | applicant | appeal bond forfeited by the employer | 0.5 GEN |
| L2 | applicant | candidate payout | 7.0 GEN |
| L3 | referrer | referral bounty | 2.7 GEN |
| L4 | protocol owner | protocol fee | 0.3 GEN |
| L5 | referrer | referral bond returned | 0.05 GEN |

`7.0 + 2.7 + 0.3 = 10.0 GEN` of escrow, both bonds accounted for, and `10.55 GEN` credited in
total. Conservation holds with real consensus and real money: the contract balance was exactly the
sum of the outstanding credits until withdrawal.

The screening rationale from the live call shows the gate doing its job:

> The candidate provided a valid README link containing clear documentation for installing the SDK
> via npm, initializing a client with createClient, and reading contract state with readContract,
> fully meeting all acceptance criteria.

The appeal is the more interesting half. The employer objected that the `readContract` snippet has an
undefined `contractAddress` and a missing comma, and the panel agreed with the objection while still
upholding the verdict:

> The README meets all three literal criteria. The appeal's point holds: contractAddress is an
> undefined placeholder, and the readContract snippet has a missing comma after args. Those flaws
> weaken the 'runnable' claim, but the criteria only require showing how to use readContract, which
> the README does. Prior PASS upheld.

That is the distinction between a valid criticism and a different verdict. The panel did not ignore
the appellant; it read the same evidence, accepted the factual point, and applied the criteria as
written. The employer's 0.5 GEN bond went to the applicant because the verdict did not move.

**The undetermined round is part of the finding, not a footnote.** The first resolution attempt did
not reach a verdict (the leader read PARTIAL against a PASS committee), so the client saw
`UNDETERMINED`. The job stayed `APPEALED`, both authenticated statements stayed on file, and the
retry upheld `PASS`. That is the protocol behaving correctly: ambiguity does not get laundered into
state, an inconclusive round costs nothing but a retry, and the dossier remains settleable.

## 11. Deployment parameters

| Parameter | Value | Why |
| --- | --- | --- |
| `fee_bps` | 300 | 3% protocol fee, capped at 10% in the constructor |
| `min_referral_bond_atto` | 0.05 GEN | Enough to make spam cost something |
| `min_escrow_atto` | 1 GEN | Keeps dust dossiers from farming reputation |
| `min_appeal_bond_atto` | 0.01 GEN | Floor for tiny escrows; otherwise 5% of escrow |

Constants that are not constructor parameters: 3-day unfulfilled grace, 7-day stall grace, 2-day
appeal answer window, 4 adjudication attempts, 3 screening attempts, 50 applications and 25 referrals
per role, 3 referrals per referrer per role, 500 bps ratio buckets with exact validator agreement, and
`PASS` fixed at 10,000 bps.
