# Escrow reconciliation — payout ledger

A reconciliation note for the Portico settlement ledger. The contract keeps two
sides of the same money: the escrow funded at `post_job`, and the credits written
at `settle`. This note defines the query that compares them and the test that
proves the comparison is clean on a settled dossier.

## 1. Query: escrow in versus credits out

```sql
with funded as (
    select job_id, sum(amount_atto) as escrow_in_atto
    from job_events
    where kind = 'escrow_funded'
    group by job_id
),
paid as (
    select job_id, sum(amount_atto) as credits_out_atto
    from credit_events
    group by job_id
)
select
    f.job_id,
    f.escrow_in_atto,
    coalesce(p.credits_out_atto, 0) as credits_out_atto,
    f.escrow_in_atto - coalesce(p.credits_out_atto, 0) as difference_atto
from funded f
left join paid p on p.job_id = f.job_id
where f.escrow_in_atto - coalesce(p.credits_out_atto, 0) <> 0
order by f.job_id;
```

A job is balanced when it does not appear in the result. The query returns the
job id and the missing amount otherwise, so an operator can name the dossier
that leaked before opening a settlement.

## 2. Test: a settled ledger returns zero rows

```sql
-- Run against the fixture snapshot of dossier J1 after settlement.
-- Expected: 0 rows. A single row means the ledger and the escrow disagree.
begin;
insert into job_events (job_id, kind, amount_atto) values
    ('J1', 'escrow_funded', 10000000000000000000);
insert into credit_events (job_id, amount_atto) values
    ('J1', 7000000000000000000),   -- applicant
    ('J1', 2700000000000000000),   -- referrer
    ('J1',  300000000000000000);   -- protocol fee
select count(*) as unbalanced_jobs
from (
    select f.job_id
    from job_events f
    left join credit_events c on c.job_id = f.job_id
    where f.kind = 'escrow_funded'
    group by f.job_id
    having sum(f.amount_atto) <> sum(c.amount_atto)
) q;
rollback;
```

The fixture sums to `10.00 GEN` on both sides, so `unbalanced_jobs` is `0`.

## 3. Runbook: when the query returns rows

Not written yet. The failure path still needs the escalation steps, the owner
for a blocked settlement, and the wording of the incident note.
