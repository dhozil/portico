# Review response — Portico

The GenLayer staff notes in the brief are drawn from several different products (prediction markets,
insurance, notaries, treasury governance). This note maps their recurring themes to this repository.
**Held** means the code already did it before this revision; **fixed** means this revision changed
it; **N/A** means the theme belongs to a different product shape and does not apply here.

## Fixed in this revision

| Review theme | What changed | Where to look |
| --- | --- | --- |
| Validators must agree on the actual verdict and the financially binding percentage | Delivery validators must match the verdict **and the exact 500 bps ratio bucket**. `PASS` is fixed at 10,000 bps, so "all criteria met" cannot pay 95%. The old 1,000 bps tolerance is gone. | `_normalize_delivery`, `_quantize_ratio`, `validator_fn`; `test_delivery_validator_binds_the_exact_ratio`, `test_a_pass_always_pays_the_full_ratio` |
| Validators must agree on the mandatory screening criteria, not an opinion score | Screening consensus compares the **hire gate** (`ELIGIBLE`/`PARTIAL` = `QUALIFIED`); `INELIGIBLE`/`FRAUD`/`UNVERIFIABLE` must match exactly. The advisory fit score no longer gates consensus. | `_screen_gate`; `test_screening_validator_binds_the_gate` |
| Each dispute party must submit its own authenticated case; resolution cannot be immediate | `appeal` opens a fixed two-day answer window. Only the non-appellant party may call `reply_to_appeal`, once. `resolve_appeal` refuses until the answer is on file or the window closes. | `appeal`, `reply_to_appeal`, `resolve_appeal`; `test_appeal_cannot_resolve_before_the_other_party_is_heard`, `test_an_unanswered_appeal_resolves_after_the_reply_window` |
| Inconclusive adjudication must not lock funded escrow forever | `recover_stalled_escrow` opens seven days after delivery when no verdict exists. Either party can close: employer refunded, referral bond returned, no fee, applicant counted as `stalled` (not failed). | `STALL_GRACE`, `recover_stalled_escrow`; `test_a_stalled_delivery_can_be_refunded_by_the_employer`, `test_the_applicant_can_also_close_a_stalled_delivery` |
| Source claims must bind to URLs that were actually submitted and fetched | Citations are filtered to the fetched set, and a positive verdict with no fetched citation is voided to `UNDETERMINED` instead of being written. | `_cite_field`, `_read_sources`, `_run_delivery`; `test_a_pass_without_a_citation_is_void` |
| Payout classification must be validated, not merely sampled | `PASS` pays 100%, `FAIL` pays 0, `PARTIAL` is snapped to 500 bps within 5–85%, and zero-ratio partials become `FAIL`. | `_quantize_ratio`; `test_a_partial_is_snapped_to_the_ratio_bucket` |
| Late delivery must not reach a verdict | `submit_work` rejects after `deliver_by`; regression test present. | `test_delivery_after_the_deadline_is_rejected` |

## Already held

- **No caller-supplied dispute inputs.** `adjudicate(job_id)` and `resolve_appeal(job_id)` take only a
  job id; the criteria, evidence URLs and statements come from stored state, and callers cannot attach
  new material.
- **One-time settlement.** `settle` requires `VERDICT` and moves to `SETTLED`; a second call reverts.
  The ledger is append-only and credits are written once. `test_settlement_conserves_escrow_and_bonds`
  sums the ledger and all payee credits.
- **Authorized appeals.** Only the employer or the hired applicant can appeal; the bond is exact.
- **Owner fees are withdrawable.** The fee is credited to the owner at settlement and released by the
  same `withdraw()` path as everyone else. `test_the_owner_can_withdraw_the_protocol_fee`.
- **Frontend accepted vs finalized.** `write()` polls the hash returned by the submitted transaction
  and only reports success on `FINALIZED` + `SUCCESS`; the UI shows each stage.
- **Pinned, resolvable dependency.** The runner is pinned and the contract deploys and executes on
  Studionet.
- **Integer money only.** No float division anywhere; `genvm-lint` enforces it.

## Not applicable

- Prediction-market oracle fixtures, handicap parsing, bet aggregation: there is no market or oracle.
- Insurance policy/issuer/licensing sources: there is no policy product.
- Honeypot caller attribution: there is no honeypot.
- Notary identity-hash confirmation: identity is never stored; payouts go to the wallet that acted.
- Treasury governance, burn policy, keeper rewards: the only protocol parameter is the fee chosen at
  deployment, and there is no treasury spend path.
- Forge receipt correlation: the stack is GenLayer + genlayer-js, not Foundry.

## Honest limits

- **Outbound transfer bounce.** Payouts are pull payments to EOAs. GenLayer does not expose a bounce
  callback to the contract, so a credit is cleared when the transfer is emitted. A native value
  transfer to an EOA cannot revert; supporting a contract payee would need a claim-and-acknowledge
  flow. This is stated in `docs/architecture.md` rather than papered over.
- **No new evidence on appeal.** Both parties argue from the committed record; that prevents
  evidence-swapping after seeing the verdict.
- **Evidence is public URLs.** Private documents would need an encrypted-blob design.
- **Reputation is per address.** Sybil resistance comes from bonds and history, not proof of personhood.
