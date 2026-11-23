"""Consensus smoke test for Portico.

The default `pytest` run uses direct mode and never touches a network. This file
is the optional second layer: it deploys the contract and drives the
deterministic half of the lifecycle through a real validator committee, which is
where storage layout, payable calls and address handling either work or do not.

    gltest tests/integration -v -s --network studionet

It is marked `slow` and excluded by `addopts = -m 'not slow'`. The three
judgement paths (screening, delivery, appeal) need real web reads and real model
calls; use `frontend/scripts/live-demo.mjs` for those and see
`docs/architecture.md` for the recorded run.
"""

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

pytestmark = pytest.mark.slow

GEN = 10 ** 18
FEE_BPS = 300
REFERRAL_BOND = 50 * 10 ** 15
MIN_ESCROW = GEN
MIN_APPEAL_BOND = 10 ** 16
ESCROW = 10 * GEN


def post_args(mode: str = "REFERRAL") -> list:
    return [
        "Backend engineer",
        "Ship a small health endpoint with tests and a deploy note.",
        "Python, HTTP APIs, automated tests.",
        "A GET /health endpoint returning {'status':'ok'}, with a passing test suite.",
        "A public repository or a deployed URL.",
        mode,
        0,
        7_000,
        2_700,
        REFERRAL_BOND,
        7,
        14,
        3,
    ]


def test_deterministic_lifecycle_under_consensus():
    factory = get_contract_factory("Portico")
    contract = factory.deploy(args=[FEE_BPS, REFERRAL_BOND, MIN_ESCROW, MIN_APPEAL_BOND])

    terms = contract.get_terms().call()
    assert terms["fee_bps"] == FEE_BPS
    assert terms["min_escrow_atto"] == MIN_ESCROW

    tx = contract.post_job(args=post_args()).transact(value=ESCROW)
    assert tx_execution_succeeded(tx)

    jobs = contract.list_jobs(args=[0, 10]).call()
    assert len(jobs) == 1
    job = jobs[0]
    job_id = job["job_id"]
    assert job["status"] == "OPEN"
    assert job["escrow_atto"] == ESCROW
    assert job["max_candidate_atto"] == 7 * GEN

    employer = contract.get_credit(args=[terms["owner"]]).call()
    assert employer == 0

    tx = contract.refer(
        args=[job_id, "0x4Ae0649230c2ADC304603755b502f5270D910684", "Worked together on a payments team."]
    ).transact(value=REFERRAL_BOND)
    assert tx_execution_succeeded(tx)

    referrals = contract.list_referrals(args=[job_id, 0, 10]).call()
    assert len(referrals) == 1
    assert referrals[0]["status"] == "PENDING"
    assert referrals[0]["bond_atto"] == REFERRAL_BOND

    tx = contract.cancel_job(args=[job_id]).transact()
    assert tx_execution_succeeded(tx)

    job = contract.get_job(args=[job_id]).call()
    assert job["status"] == "CANCELLED"
    assert job["employer_refund_atto"] == ESCROW

    stats = contract.get_stats().call()
    assert stats["jobs_posted"] == 1
    assert stats["jobs_cancelled"] == 1
    assert stats["referrals"] == 1

    passport = contract.get_passport(args=[terms["owner"]]).call()
    assert passport["digest"].startswith("0x")
    assert len(passport["digest"]) == 66
