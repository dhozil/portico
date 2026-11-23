export type Num = bigint | number | string

export interface Terms {
  owner: string
  fee_bps: Num
  min_escrow_atto: Num
  min_referral_bond_atto: Num
  min_appeal_bond_atto: Num
  max_apps_per_job: Num
  max_refs_per_job: Num
  max_refs_per_referrer: Num
  max_adjudications: Num
  pass_floor_bps: Num
  partial_ceiling_bps: Num
  ratio_step_bps: Num
  stall_grace_days: Num
  appeal_reply_days: Num
}

export interface Stats {
  jobs_posted: Num
  jobs_cancelled: Num
  jobs_expired: Num
  jobs_unfulfilled: Num
  jobs_settled: Num
  jobs_stalled: Num
  referrals: Num
  appeal_replies: Num
  referral_fraud: Num
  applications: Num
  applications_withdrawn: Num
  screened_out: Num
  fraud_flagged: Num
  hires: Num
  deliveries: Num
  resubmissions: Num
  verdicts: Num
  adjudications_unreadable: Num
  appeals: Num
  appeals_resolved: Num
  ledger_entries: Num
  escrowed_atto: Num
  bonds_locked_atto: Num
  bonds_slashed_atto: Num
  appeal_bonds_forfeited_atto: Num
  paid_out_atto: Num
  credited_atto: Num
  withdrawn_atto: Num
  jobs_total: Num
  applications_total: Num
  referrals_total: Num
}

export type JobStatus =
  | 'OPEN'
  | 'HIRED'
  | 'DELIVERED'
  | 'VERDICT'
  | 'APPEALED'
  | 'SETTLED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'UNFULFILLED'
  | 'STALLED'

export interface Job {
  job_id: string
  employer: string
  title: string
  role: string
  requirements: string
  deliverable_spec: string
  evidence_hint: string
  access_mode: 'OPEN' | 'REFERRAL'
  min_referrer_score: Num
  escrow_atto: Num
  candidate_bps: Num
  referrer_bps: Num
  fee_bps: Num
  referral_bond_atto: Num
  status: JobStatus
  candidate: string
  referrer: string
  created_at: Num
  apply_by: Num
  deliver_days: Num
  appeal_days: Num
  deliver_by: Num
  hired_at: Num
  delivered_at: Num
  submission_summary: string
  submission_evidence: string
  adjudications: Num
  verdict: string
  payout_ratio_bps: Num
  confidence: Num
  rationale: string
  cited_sources: string
  evidence_status: string
  adjudicated_at: Num
  appeal_deadline: Num
  appeal_bond_atto: Num
  appellant: string
  appeal_statement: string
  appeal_reply: string
  appeal_replier: string
  appeal_reply_deadline: Num
  stall_after: Num
  appeal_resolved: boolean
  appealed: boolean
  prior_ratio_bps: Num
  bond_outcome: string
  candidate_paid_atto: Num
  referrer_paid_atto: Num
  fee_paid_atto: Num
  employer_refund_atto: Num
  settled_at: Num
  applications: Num
  referrals: Num
  max_candidate_atto: Num
  max_referrer_atto: Num
  max_fee_atto: Num
  verdict_candidate_atto: Num
  verdict_referrer_atto: Num
}

export interface Application {
  app_id: string
  job_id: string
  candidate: string
  referrer: string
  pitch: string
  skills: string
  evidence: string
  status: 'PENDING' | 'HIRED' | 'REJECTED' | 'WITHDRAWN'
  screening: '' | 'ELIGIBLE' | 'PARTIAL' | 'INELIGIBLE' | 'FRAUD' | 'UNVERIFIABLE'
  fit_score: Num
  evidence_quality: Num
  screening_notes: string
  screen_attempts: Num
  created_at: Num
}

export interface Referral {
  referral_id: string
  job_id: string
  referrer: string
  candidate: string
  note: string
  bond_atto: Num
  status: 'PENDING' | 'SELECTED' | 'RETURNED' | 'REWARDED' | 'SLASHED'
  created_at: Num
  resolved_at: Num
}

export interface LedgerEntry {
  entry_id: string
  job_id: string
  recipient: string
  role: string
  amount_atto: Num
  created_at: Num
}

export interface Profile {
  account: string
  score: Num
  candidate_jobs: Num
  candidate_passes: Num
  candidate_partials: Num
  candidate_fails: Num
  candidate_no_shows: Num
  candidate_stalled: Num
  referrer_referrals: Num
  referrer_hires: Num
  referrer_successes: Num
  referrer_slashes: Num
  screened_out: Num
  earned_atto: Num
  last_active: Num
  withdrawable_atto?: Num
  known?: boolean
}

export interface Passport {
  protocol: string
  version: string
  account: string
  score: Num
  candidate: {
    jobs: Num
    passes: Num
    partials: Num
    fails: Num
    no_shows: Num
    stalled?: Num
  }
  referrer: {
    referrals: Num
    hires: Num
    successes: Num
    slashes: Num
  }
  screened_out: Num
  earned_atto: Num
  last_active: Num
  digest: string
}

export type TxStage =
  | 'SIGNING'
  | 'SUBMITTED'
  | 'CONSENSUS'
  | 'ACCEPTED'
  | 'FINALIZED'
  | 'UNDETERMINED'
  | 'CANCELED'
  | 'FAILED'

export interface WriteResult {
  hash: string
  ok: boolean
  status: string
  execution: string
  payload: string
}

export interface TxRun {
  label: string
  stage: TxStage
  hash?: string
  status?: string
  error?: string
  payload?: string
}

export interface Wallet {
  address: string
  provider: Eip1193
}

export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
}
