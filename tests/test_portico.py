"""Direct-mode tests for Portico.

These run the contract in-process: ~30ms per test, no server, no consensus.
Web and LLM calls are mocked, so the suite covers business logic, escrow
accounting, deadlines, reputation and the validator comparison rules. Real
consensus is exercised separately in tests/integration.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

GEN = 10 ** 18
BPS = 10_000
FEE_BPS = 300
REFERRAL_BOND = 50 * 10 ** 15  # 0.05 GEN
MIN_ESCROW = 1 * GEN
MIN_APPEAL_BOND = 10 ** 16  # 0.01 GEN

BASE = datetime(2031, 1, 1, tzinfo=timezone.utc)
BASE_ISO = BASE.isoformat()

CANDIDATE_URL = "https://portfolio.example/ada"
CANDIDATE_URL_2 = "https://github.example/ada/health-api"
DELIVERABLE_URL = "https://work.example/ada/health-endpoint"
DELIVERABLE_URL_2 = "https://work.example/ada/tests"

REQUIREMENTS = "Three years of Python backend work, HTTP APIs, and automated tests."
CRITERIA = "A GET /health endpoint that returns {'status':'ok'}, with a passing test suite."
EVIDENCE_HINT = "A public repository or a deployed URL that a reviewer can open."

CANDIDATE_PAGE = (
    "Ada Lovelace — backend engineer. Shipped three Python HTTP services. "
    "Public repos: health-api (FastAPI, pytest), billing-worker (Celery)."
)
DELIVERABLE_PAGE = (
    "health-api v1.0.0. GET /health returns {\"status\":\"ok\"}. "
    "tests/test_health.py: 4 passed. README documents the run command."
)

SCREEN_OK = {
    "verdict": "ELIGIBLE",
    "fit_score": 86,
    "evidence_quality": 80,
    "requirements_met": ["python", "http apis", "tests"],
    "requirements_missing": [],
    "rationale": "The repository shows two shipped Python services with tests.",
    "cited_sources": [CANDIDATE_URL],
}

SCREEN_THIN = {
    "verdict": "PARTIAL",
    "fit_score": 55,
    "evidence_quality": 40,
    "requirements_met": ["python"],
    "requirements_missing": ["http apis"],
    "rationale": "The profile claims API work but no service is linked.",
    "cited_sources": [CANDIDATE_URL],
}

SCREEN_INELIGIBLE = {
    "verdict": "INELIGIBLE",
    "fit_score": 18,
    "evidence_quality": 30,
    "requirements_met": [],
    "requirements_missing": ["python", "http apis"],
    "rationale": "The evidence is a design portfolio with no backend work.",
    "cited_sources": [CANDIDATE_URL],
}

SCREEN_FRAUD = {
    "verdict": "FRAUD",
    "fit_score": 10,
    "evidence_quality": 5,
    "requirements_met": [],
    "requirements_missing": ["python"],
    "rationale": "The linked repository is a copy of a different engineer's project.",
    "cited_sources": [CANDIDATE_URL],
}

DELIVERY_PASS = {
    "verdict": "PASS",
    "payout_ratio_bps": 10_000,
    "criteria_met": ["health endpoint", "passing tests"],
    "criteria_missing": [],
    "confidence": 88,
    "rationale": "The endpoint returns the required payload and the tests pass.",
    "cited_sources": [DELIVERABLE_URL],
}

DELIVERY_PARTIAL = {
    "verdict": "PARTIAL",
    "payout_ratio_bps": 6_000,
    "criteria_met": ["health endpoint"],
    "criteria_missing": ["passing tests"],
    "confidence": 75,
    "rationale": "The endpoint exists but the test suite is missing.",
    "cited_sources": [DELIVERABLE_URL],
}

DELIVERY_FAIL = {
    "verdict": "FAIL",
    "payout_ratio_bps": 0,
    "criteria_met": [],
    "criteria_missing": ["health endpoint", "passing tests"],
    "confidence": 82,
    "rationale": "The linked page is a blog post, not the requested service.",
    "cited_sources": [DELIVERABLE_URL],
}

APPEAL_PARTIAL = {
    "verdict": "PARTIAL",
    "payout_ratio_bps": 6_000,
    "criteria_met": ["health endpoint"],
    "criteria_missing": ["passing tests"],
    "confidence": 84,
    "rationale": "On review the tests are not in the linked repository.",
    "cited_sources": [DELIVERABLE_URL],
}

APPEAL_PASS = dict(DELIVERY_PASS)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def hx(addr) -> str:
    if isinstance(addr, (bytes, bytearray)):
        from genlayer.py.types import Address

        return Address(bytes(addr)).as_hex
    return addr.as_hex


@pytest.fixture(autouse=True)
def pinned_clock(direct_vm):
    direct_vm.warp(BASE_ISO)
    return direct_vm


def jump(direct_vm, days: int) -> None:
    direct_vm.warp(iso(BASE + timedelta(days=days)))


def as_user(direct_vm, addr, value: int = 0):
    class _Ctx:
        def __enter__(self):
            self.sender = direct_vm.sender
            self.value = direct_vm.value
            direct_vm.sender = addr
            direct_vm.value = value
            return direct_vm

        def __exit__(self, *exc):
            direct_vm.sender = self.sender
            direct_vm.value = self.value
            return False

    return _Ctx()


def mock_sources(
    direct_vm,
    screening=SCREEN_OK,
    delivery=DELIVERY_PASS,
    appeal=APPEAL_PASS,
    candidate_status: int = 200,
    deliverable_status: int = 200,
    candidate_page: str = CANDIDATE_PAGE,
    deliverable_page: str = DELIVERABLE_PAGE,
) -> None:
    direct_vm.mock_web(
        r"portfolio\.example", {"status": candidate_status, "body": candidate_page}
    )
    direct_vm.mock_web(
        r"github\.example", {"status": candidate_status, "body": candidate_page}
    )
    direct_vm.mock_web(
        r"work\.example", {"status": deliverable_status, "body": deliverable_page}
    )
    direct_vm.mock_llm(r"You are the referral gatekeeper", json.dumps(screening))
    direct_vm.mock_llm(r"You are the delivery adjudicator", json.dumps(delivery))
    direct_vm.mock_llm(r"You are the appeal panel", json.dumps(appeal))


def deploy(direct_deploy):
    return direct_deploy(
        "contracts/portico.py", FEE_BPS, REFERRAL_BOND, MIN_ESCROW, MIN_APPEAL_BOND
    )


def post(
    direct_vm,
    contract,
    employer,
    escrow: int = 10 * GEN,
    mode: str = "REFERRAL",
    min_score: int = 0,
    candidate_bps: int = 7_000,
    referrer_bps: int = 2_700,
    bond: int = REFERRAL_BOND,
    apply_days: int = 7,
    deliver_days: int = 14,
    appeal_days: int = 3,
) -> str:
    with as_user(direct_vm, employer, escrow):
        return contract.post_job(
            "Backend engineer",
            "Ship a small health endpoint for the payments API.",
            REQUIREMENTS,
            CRITERIA,
            EVIDENCE_HINT,
            mode,
            min_score,
            candidate_bps,
            referrer_bps,
            bond,
            apply_days,
            deliver_days,
            appeal_days,
        )


def refer(direct_vm, contract, referrer, job_id: str, candidate, bond: int = REFERRAL_BOND) -> str:
    with as_user(direct_vm, referrer, bond):
        return contract.refer(job_id, hx(candidate), "Worked with them on a payments team.")


def apply_to(direct_vm, contract, candidate, job_id: str, url: str = CANDIDATE_URL) -> str:
    with as_user(direct_vm, candidate):
        return contract.apply(
            job_id,
            "I have shipped three Python services and can start this week.",
            "python, fastapi, pytest",
            url,
        )


def screen(direct_vm, contract, employer, job_id: str, candidate) -> str:
    with as_user(direct_vm, employer):
        return contract.review_application(job_id, hx(candidate))


def hire(direct_vm, contract, employer, job_id: str, candidate) -> str:
    with as_user(direct_vm, employer):
        return contract.hire(job_id, hx(candidate))


def deliver(direct_vm, contract, candidate, job_id: str, url: str = DELIVERABLE_URL) -> str:
    with as_user(direct_vm, candidate):
        return contract.submit_work(job_id, "The endpoint and its tests are deployed.", url)


def adjudicate(direct_vm, contract, caller, job_id: str) -> str:
    with as_user(direct_vm, caller):
        return contract.adjudicate(job_id)


def settle(direct_vm, contract, caller, job_id: str) -> str:
    with as_user(direct_vm, caller):
        return contract.settle(job_id)


def credit(contract, addr) -> int:
    return int(contract.get_credit(hx(addr)))


# ---------------------------------------------------------------------------
# Terms and posting
# ---------------------------------------------------------------------------
def test_terms_and_empty_state(direct_deploy, direct_owner):
    contract = deploy(direct_deploy)
    terms = contract.get_terms()
    assert terms["owner"] == hx(direct_owner)
    assert terms["fee_bps"] == FEE_BPS
    assert terms["min_escrow_atto"] == MIN_ESCROW
    assert terms["min_referral_bond_atto"] == REFERRAL_BOND
    assert terms["pass_floor_bps"] == 9_000
    assert contract.get_stats()["jobs_posted"] == 0
    assert contract.list_jobs(0, 10) == []


def test_post_job_requires_minimum_escrow(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    with as_user(direct_vm, direct_alice, MIN_ESCROW - 1):
        with direct_vm.expect_revert("[EXPECTED] escrow below the protocol minimum"):
            contract.post_job(
                "Backend engineer", "Role", REQUIREMENTS, CRITERIA, EVIDENCE_HINT,
                "OPEN", 0, 7_000, 2_700, REFERRAL_BOND, 7, 14, 3,
            )


def test_post_job_requires_split_to_sum_to_10000(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    with as_user(direct_vm, direct_alice, 10 * GEN):
        with direct_vm.expect_revert("[EXPECTED] candidate, referrer and fee bps must sum to 10000"):
            contract.post_job(
                "Backend engineer", "Role", REQUIREMENTS, CRITERIA, EVIDENCE_HINT,
                "OPEN", 0, 6_000, 2_700, REFERRAL_BOND, 7, 14, 3,
            )


def test_post_job_rejects_unknown_access_mode(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    with as_user(direct_vm, direct_alice, 10 * GEN):
        with direct_vm.expect_revert("[EXPECTED] access mode must be OPEN or REFERRAL"):
            contract.post_job(
                "Backend engineer", "Role", REQUIREMENTS, CRITERIA, EVIDENCE_HINT,
                "INVITE", 0, 7_000, 2_700, REFERRAL_BOND, 7, 14, 3,
            )


def test_referral_gated_job_needs_a_bounty(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    with as_user(direct_vm, direct_alice, 10 * GEN):
        with direct_vm.expect_revert("[EXPECTED] a referral-gated job needs a referrer bounty"):
            contract.post_job(
                "Backend engineer", "Role", REQUIREMENTS, CRITERIA, EVIDENCE_HINT,
                "REFERRAL", 0, 9_700, 0, REFERRAL_BOND, 7, 14, 3,
            )


def test_post_job_stores_the_spec_and_deadlines(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    job = contract.get_job(job_id)
    assert job_id == "J1"
    assert job["employer"] == hx(direct_alice)
    assert job["status"] == "OPEN"
    assert job["escrow_atto"] == 10 * GEN
    assert job["access_mode"] == "REFERRAL"
    assert job["deliverable_spec"] == CRITERIA
    assert job["apply_by"] == int(BASE.timestamp()) + 7 * 86_400
    assert job["deliver_days"] == 14
    assert job["appeal_days"] == 3
    assert job["max_candidate_atto"] == 7 * GEN
    assert job["max_referrer_atto"] == 27 * GEN // 10
    assert job["max_fee_atto"] == 3 * GEN // 10
    assert contract.get_stats()["escrowed_atto"] == 10 * GEN


# ---------------------------------------------------------------------------
# Referrals
# ---------------------------------------------------------------------------
def test_refer_requires_the_exact_bond(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    with as_user(direct_vm, direct_bob, REFERRAL_BOND - 1):
        with direct_vm.expect_revert("[EXPECTED] referral bond must be exactly"):
            contract.refer(job_id, hx(direct_charlie), "Strong candidate")


def test_refer_rejects_self_and_employer(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    with as_user(direct_vm, direct_bob, REFERRAL_BOND):
        with direct_vm.expect_revert("[EXPECTED] you cannot refer yourself"):
            contract.refer(job_id, hx(direct_bob), "Me")
    with as_user(direct_vm, direct_alice, REFERRAL_BOND):
        with direct_vm.expect_revert("[EXPECTED] the employer cannot refer a candidate"):
            contract.refer(job_id, hx(direct_bob), "Friend")


def test_refer_is_unique_per_candidate(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    with as_user(direct_vm, direct_bob, REFERRAL_BOND):
        with direct_vm.expect_revert("[EXPECTED] this candidate already has a referral"):
            contract.refer(job_id, hx(direct_charlie), "Again")


def test_refer_creates_a_locked_bond_and_reputation(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    referral_id = refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    referral = contract.get_referral(referral_id)
    assert referral["status"] == "PENDING"
    assert referral["bond_atto"] == REFERRAL_BOND
    profile = contract.get_profile(hx(direct_bob))
    assert profile["referrer_referrals"] == 1
    assert profile["score"] == 500
    assert contract.get_stats()["bonds_locked_atto"] == REFERRAL_BOND


def test_referrer_score_gate_blocks_a_thin_referrer(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice, min_score=600)
    with as_user(direct_vm, direct_bob, REFERRAL_BOND):
        with direct_vm.expect_revert("[EXPECTED] your reputation does not open this job"):
            contract.refer(job_id, hx(direct_charlie), "Trust me")


def test_referral_cap_per_referrer(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_accounts
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    candidates = [addr for addr in direct_accounts if addr != direct_alice][:4]
    for index in range(3):
        refer(direct_vm, contract, direct_bob, job_id, candidates[index])
    with as_user(direct_vm, direct_bob, REFERRAL_BOND):
        with direct_vm.expect_revert("[EXPECTED] referral cap reached for this job"):
            contract.refer(job_id, hx(candidates[3]), "One more")


# ---------------------------------------------------------------------------
# Applications and access
# ---------------------------------------------------------------------------
def test_gated_job_rejects_unreferred_application(
    direct_vm, direct_deploy, direct_alice, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    with as_user(direct_vm, direct_charlie):
        with direct_vm.expect_revert("[EXPECTED] this job is open by referral only"):
            contract.apply(job_id, "Let me in", "python", CANDIDATE_URL)


def test_open_job_accepts_a_direct_application(
    direct_vm, direct_deploy, direct_alice, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice, mode="OPEN")
    app_id = apply_to(direct_vm, contract, direct_charlie, job_id)
    app = contract.get_application(job_id, hx(direct_charlie))
    assert app_id == "A1"
    assert app["referrer"] == ""
    assert app["status"] == "PENDING"
    assert app["screening"] == ""
    assert app["evidence"] == CANDIDATE_URL


def test_application_records_the_referrer(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    app = contract.get_application(job_id, hx(direct_charlie))
    assert app["referrer"] == hx(direct_bob)


def test_duplicate_application_is_rejected(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    with as_user(direct_vm, direct_charlie):
        with direct_vm.expect_revert("[EXPECTED] you already applied to this job"):
            contract.apply(job_id, "Again", "python", CANDIDATE_URL)


def test_application_requires_http_evidence(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    with as_user(direct_vm, direct_charlie):
        with direct_vm.expect_revert("[EXPECTED] evidence must be http(s) URLs"):
            contract.apply(job_id, "Pitch", "python", "my-cv.pdf")


def test_employer_cannot_apply(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice, mode="OPEN")
    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] the employer cannot apply"):
            contract.apply(job_id, "Pitch", "python", CANDIDATE_URL)


# ---------------------------------------------------------------------------
# Screening: the access decision
# ---------------------------------------------------------------------------
def test_review_requires_the_employer(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    with as_user(direct_vm, direct_bob):
        with direct_vm.expect_revert("[EXPECTED] only the employer reviews applications"):
            contract.review_application(job_id, hx(direct_charlie))


def test_screening_marks_the_application_eligible(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    assert screen(direct_vm, contract, direct_alice, job_id, direct_charlie) == "ELIGIBLE"
    app = contract.get_application(job_id, hx(direct_charlie))
    assert app["screening"] == "ELIGIBLE"
    assert app["fit_score"] == 86
    assert app["screen_attempts"] == 1
    assert contract.get_stats()["fraud_flagged"] == 0


def test_screening_fraud_slashes_the_referral_bond(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm, screening=SCREEN_FRAUD)
    job_id = post(direct_vm, contract, direct_alice)
    referral_id = refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    assert screen(direct_vm, contract, direct_alice, job_id, direct_charlie) == "FRAUD"
    referral = contract.get_referral(referral_id)
    assert referral["status"] == "SLASHED"
    assert credit(contract, direct_alice) == REFERRAL_BOND
    assert contract.get_profile(hx(direct_bob))["referrer_slashes"] == 1
    assert contract.get_profile(hx(direct_charlie))["screened_out"] == 1
    assert contract.get_application(job_id, hx(direct_charlie))["status"] == "REJECTED"
    assert contract.get_stats()["referral_fraud"] == 1


def test_unreadable_evidence_allows_a_rescreen(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm, candidate_status=404)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    assert screen(direct_vm, contract, direct_alice, job_id, direct_charlie) == "UNVERIFIABLE"
    direct_vm.clear_mocks()
    mock_sources(direct_vm)
    assert screen(direct_vm, contract, direct_alice, job_id, direct_charlie) == "ELIGIBLE"
    app = contract.get_application(job_id, hx(direct_charlie))
    assert app["screen_attempts"] == 2


def test_screening_validator_rejects_a_flipped_verdict(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    screen(direct_vm, contract, direct_alice, job_id, direct_charlie)
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_result={"verdict": "INELIGIBLE", "fit_score": 20}) is False


def test_screening_validator_binds_the_gate(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    screen(direct_vm, contract, direct_alice, job_id, direct_charlie)
    # ELIGIBLE and PARTIAL are the same hire gate; the advisory fit score does
    # not decide consensus. A different gate (INELIGIBLE, FRAUD) cannot pass.
    assert direct_vm.run_validator(leader_result={"verdict": "ELIGIBLE", "fit_score": 78}) is True
    assert direct_vm.run_validator(leader_result={"verdict": "ELIGIBLE", "fit_score": 12}) is True
    assert direct_vm.run_validator(leader_result={"verdict": "PARTIAL", "fit_score": 80}) is True
    assert direct_vm.run_validator(leader_result={"verdict": "INELIGIBLE", "fit_score": 80}) is False


# ---------------------------------------------------------------------------
# Hiring
# ---------------------------------------------------------------------------
def test_hire_requires_screening(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] review the application before hiring"):
            contract.hire(job_id, hx(direct_charlie))


def test_hire_rejects_an_ineligible_candidate(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm, screening=SCREEN_INELIGIBLE)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    screen(direct_vm, contract, direct_alice, job_id, direct_charlie)
    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] review the application before hiring"):
            contract.hire(job_id, hx(direct_charlie))


def test_hire_selects_the_referrer_and_returns_other_bonds(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_accounts
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm)
    job_id = post(direct_vm, contract, direct_alice)
    other_candidate = [addr for addr in direct_accounts if addr not in (direct_alice, direct_bob, direct_charlie)][0]
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    refer(direct_vm, contract, direct_bob, job_id, other_candidate)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    apply_to(direct_vm, contract, other_candidate, job_id)
    screen(direct_vm, contract, direct_alice, job_id, direct_charlie)
    assert hire(direct_vm, contract, direct_alice, job_id, direct_charlie) == "HIRED"
    job = contract.get_job(job_id)
    assert job["candidate"] == hx(direct_charlie)
    assert job["referrer"] == hx(direct_bob)
    assert job["deliver_by"] == int(BASE.timestamp()) + 14 * 86_400
    referrals = contract.list_referrals(job_id, 0, 10)
    statuses = {row["candidate"]: row["status"] for row in referrals}
    assert statuses[hx(direct_charlie)] == "SELECTED"
    assert statuses[hx(other_candidate)] == "RETURNED"
    assert credit(contract, direct_bob) == REFERRAL_BOND
    assert contract.list_applications(job_id, 0, 10)[1]["status"] == "REJECTED"
    assert contract.get_profile(hx(direct_bob))["referrer_hires"] == 1


def test_hire_requires_the_employer(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    screen(direct_vm, contract, direct_alice, job_id, direct_charlie)
    with as_user(direct_vm, direct_charlie):
        with direct_vm.expect_revert("[EXPECTED] only the employer hires"):
            contract.hire(job_id, hx(direct_charlie))


# ---------------------------------------------------------------------------
# Delivery and adjudication
# ---------------------------------------------------------------------------
def hired_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, **kwargs):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm, **kwargs)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    apply_to(direct_vm, contract, direct_charlie, job_id)
    screen(direct_vm, contract, direct_alice, job_id, direct_charlie)
    hire(direct_vm, contract, direct_alice, job_id, direct_charlie)
    return contract, job_id


def test_only_the_hired_applicant_submits_work(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    with as_user(direct_vm, direct_bob):
        with direct_vm.expect_revert("[EXPECTED] only the hired applicant delivers work"):
            contract.submit_work(job_id, "Done", DELIVERABLE_URL)


def test_delivery_after_the_deadline_is_rejected(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    jump(direct_vm, 15)
    with as_user(direct_vm, direct_charlie):
        with direct_vm.expect_revert("[EXPECTED] the delivery deadline has passed"):
            contract.submit_work(job_id, "Late", DELIVERABLE_URL)


def test_delivery_moves_the_job_to_review(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    assert deliver(direct_vm, contract, direct_charlie, job_id) == "DELIVERED"
    job = contract.get_job(job_id)
    assert job["status"] == "DELIVERED"
    assert job["submission_evidence"] == DELIVERABLE_URL
    assert job["delivered_at"] == int(BASE.timestamp())


def test_adjudication_pays_candidate_and_referrer(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    deliver(direct_vm, contract, direct_charlie, job_id)
    assert adjudicate(direct_vm, contract, direct_bob, job_id) == "PASS"
    job = contract.get_job(job_id)
    assert job["verdict"] == "PASS"
    assert job["payout_ratio_bps"] == 10_000
    assert job["appeal_deadline"] == int(BASE.timestamp()) + 3 * 86_400
    jump(direct_vm, 4)
    assert settle(direct_vm, contract, direct_bob, job_id) == "SETTLED"
    job = contract.get_job(job_id)
    assert job["candidate_paid_atto"] == 7 * GEN
    assert job["referrer_paid_atto"] == 27 * GEN // 10
    assert job["fee_paid_atto"] == 3 * GEN // 10
    assert job["employer_refund_atto"] == 0
    # The selected referrer also gets the bond back on a pass.
    assert credit(contract, direct_charlie) == 7 * GEN
    assert credit(contract, direct_bob) == 27 * GEN // 10 + REFERRAL_BOND
    assert credit(contract, direct_alice) == 0
    assert contract.get_profile(hx(direct_charlie))["candidate_passes"] == 1
    assert contract.get_profile(hx(direct_bob))["referrer_successes"] == 1


def test_partial_verdict_pays_proportionally_and_refunds_the_rest(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, delivery=DELIVERY_PARTIAL
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    assert adjudicate(direct_vm, contract, direct_alice, job_id) == "PARTIAL"
    jump(direct_vm, 4)
    settle(direct_vm, contract, direct_alice, job_id)
    job = contract.get_job(job_id)
    assert job["candidate_paid_atto"] == 42 * GEN // 10
    assert job["referrer_paid_atto"] == 162 * GEN // 100
    assert job["fee_paid_atto"] == 18 * GEN // 100
    assert job["employer_refund_atto"] == 4 * GEN
    assert credit(contract, direct_charlie) == 42 * GEN // 10
    assert credit(contract, direct_alice) == 4 * GEN
    assert contract.get_profile(hx(direct_charlie))["candidate_partials"] == 1


def test_failed_work_refunds_the_employer_and_splits_the_bond(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, delivery=DELIVERY_FAIL
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    assert adjudicate(direct_vm, contract, direct_alice, job_id) == "FAIL"
    jump(direct_vm, 4)
    settle(direct_vm, contract, direct_alice, job_id)
    job = contract.get_job(job_id)
    assert job["candidate_paid_atto"] == 0
    assert job["referrer_paid_atto"] == 0
    assert job["employer_refund_atto"] == 10 * GEN
    assert credit(contract, direct_charlie) == 0
    assert credit(contract, direct_alice) == 10 * GEN + REFERRAL_BOND // 2
    assert credit(contract, direct_bob) == REFERRAL_BOND // 2
    assert contract.list_referrals(job_id, 0, 1)[0]["status"] == "SLASHED"


def test_open_job_without_a_referrer_refunds_that_share(
    direct_vm, direct_deploy, direct_alice, direct_charlie
):
    contract = deploy(direct_deploy)
    mock_sources(direct_vm)
    job_id = post(direct_vm, contract, direct_alice, mode="OPEN")
    apply_to(direct_vm, contract, direct_charlie, job_id)
    screen(direct_vm, contract, direct_alice, job_id, direct_charlie)
    hire(direct_vm, contract, direct_alice, job_id, direct_charlie)
    deliver(direct_vm, contract, direct_charlie, job_id)
    adjudicate(direct_vm, contract, direct_alice, job_id)
    jump(direct_vm, 4)
    settle(direct_vm, contract, direct_alice, job_id)
    job = contract.get_job(job_id)
    assert job["candidate_paid_atto"] == 7 * GEN
    assert job["referrer_paid_atto"] == 0
    assert job["employer_refund_atto"] == 27 * GEN // 10
    assert credit(contract, direct_alice) == 27 * GEN // 10


def test_unreadable_delivery_stays_open_for_a_repair(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, deliverable_status=404
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    assert adjudicate(direct_vm, contract, direct_alice, job_id) == "UNDETERMINED"
    job = contract.get_job(job_id)
    assert job["status"] == "DELIVERED"
    assert job["verdict"] == ""
    assert job["adjudications"] == 1
    direct_vm.clear_mocks()
    mock_sources(direct_vm)
    assert adjudicate(direct_vm, contract, direct_alice, job_id) == "PASS"


def test_adjudication_attempts_are_capped(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, deliverable_status=404
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    for _ in range(4):
        assert adjudicate(direct_vm, contract, direct_alice, job_id) == "UNDETERMINED"
    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] adjudication attempts are exhausted"):
            contract.adjudicate(job_id)


def test_delivery_validator_rejects_a_flipped_verdict(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    deliver(direct_vm, contract, direct_charlie, job_id)
    adjudicate(direct_vm, contract, direct_alice, job_id)
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_result={"verdict": "FAIL", "ratio": 0}) is False
    assert direct_vm.run_validator(leader_result={"verdict": "PASS", "ratio": 4_000}) is False


def test_delivery_validator_binds_the_exact_ratio(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    deliver(direct_vm, contract, direct_charlie, job_id)
    adjudicate(direct_vm, contract, direct_alice, job_id)
    # The mocked leader paid 10,000 bps: only that exact bucket agrees.
    assert direct_vm.run_validator(leader_result={"verdict": "PASS", "ratio": 10_000}) is True
    assert direct_vm.run_validator(leader_result={"verdict": "PASS", "ratio": 9_500}) is False
    # Nor can a different category ride along on a near-total ratio.
    assert direct_vm.run_validator(leader_result={"verdict": "PARTIAL", "ratio": 9_000}) is False


# ---------------------------------------------------------------------------
# Appeal
# ---------------------------------------------------------------------------
def verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, **kwargs):
    contract, job_id = hired_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, **kwargs)
    deliver(direct_vm, contract, direct_charlie, job_id)
    adjudicate(direct_vm, contract, direct_alice, job_id)
    return contract, job_id


def test_settle_before_the_appeal_window_closes_is_rejected(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] the appeal window is still open"):
            contract.settle(job_id)


def test_appeal_requires_the_exact_bond(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    required = 10 * GEN * 500 // BPS
    with as_user(direct_vm, direct_alice, required - 1):
        with direct_vm.expect_revert("[EXPECTED] appeal bond must be exactly"):
            contract.appeal(job_id, "The tests were in a second repository.")


def test_only_a_party_can_appeal(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    required = 10 * GEN * 500 // BPS
    with as_user(direct_vm, direct_bob, required):
        with direct_vm.expect_revert("[EXPECTED] only the employer or the applicant can appeal"):
            contract.appeal(job_id, "I object as a bystander.")


def test_employer_appeal_can_reduce_the_payout(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    bond = 10 * GEN * 500 // BPS
    with as_user(direct_vm, direct_alice, bond):
        assert contract.appeal(job_id, "The linked repository has no tests.") == "APPEALED"
    direct_vm.clear_mocks()
    mock_sources(direct_vm, appeal=APPEAL_PARTIAL)
    with as_user(direct_vm, direct_charlie):
        assert contract.reply_to_appeal(job_id, "The tests are in the repository root.") == "APPEALED"
    with as_user(direct_vm, direct_bob):
        assert contract.resolve_appeal(job_id) == "PARTIAL"
    job = contract.get_job(job_id)
    assert job["payout_ratio_bps"] == 6_000
    assert job["appeal_resolved"] is True
    assert job["bond_outcome"] == "APPEAL_BOND_RETURN"
    assert credit(contract, direct_alice) == bond
    settle(direct_vm, contract, direct_alice, job_id)
    assert credit(contract, direct_charlie) == 42 * GEN // 10
    assert contract.get_job(job_id)["status"] == "SETTLED"


def test_losing_appeal_bond_goes_to_the_counterparty(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    bond = 10 * GEN * 500 // BPS
    with as_user(direct_vm, direct_charlie, bond):
        contract.appeal(job_id, "I delivered more than the criteria asked for.")
    direct_vm.clear_mocks()
    mock_sources(direct_vm, appeal=APPEAL_PASS)
    with as_user(direct_vm, direct_alice):
        assert contract.reply_to_appeal(job_id, "Every criterion was evidenced in the delivery.") == "APPEALED"
    with as_user(direct_vm, direct_alice):
        assert contract.resolve_appeal(job_id) == "PASS"
    job = contract.get_job(job_id)
    assert job["bond_outcome"] == "APPEAL_BOND_FORFEIT"
    assert credit(contract, direct_charlie) == 0
    assert credit(contract, direct_alice) == bond
    assert contract.get_stats()["appeal_bonds_forfeited_atto"] == bond


def test_appeal_without_a_readable_record_keeps_the_verdict(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, delivery=DELIVERY_FAIL
    )
    bond = 10 * GEN * 500 // BPS
    with as_user(direct_vm, direct_charlie, bond):
        contract.appeal(job_id, "The link was temporarily down.")
    direct_vm.clear_mocks()
    mock_sources(direct_vm, deliverable_status=503)
    with as_user(direct_vm, direct_alice):
        assert contract.reply_to_appeal(job_id, "The service is still deployed and the link works.") == "APPEALED"
    with as_user(direct_vm, direct_alice):
        assert contract.resolve_appeal(job_id) == "UNDETERMINED"
    job = contract.get_job(job_id)
    assert job["verdict"] == "FAIL"
    assert job["payout_ratio_bps"] == 0
    assert job["appeal_resolved"] is True
    assert credit(contract, direct_charlie) == bond
    settle(direct_vm, contract, direct_alice, job_id)
    assert credit(contract, direct_alice) == 10 * GEN + REFERRAL_BOND // 2


# ---------------------------------------------------------------------------
# Withdrawal
# ---------------------------------------------------------------------------
def test_withdraw_releases_the_credit(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    jump(direct_vm, 4)
    settle(direct_vm, contract, direct_alice, job_id)
    assert contract.get_credit(hx(direct_charlie)) == 7 * GEN
    with as_user(direct_vm, direct_charlie):
        assert contract.withdraw() == 7 * GEN
    assert contract.get_credit(hx(direct_charlie)) == 0
    assert contract.get_stats()["withdrawn_atto"] == 7 * GEN


def test_withdraw_without_credit_reverts(direct_vm, direct_deploy, direct_bob):
    contract = deploy(direct_deploy)
    with as_user(direct_vm, direct_bob):
        with direct_vm.expect_revert("[EXPECTED] nothing to withdraw"):
            contract.withdraw()


# ---------------------------------------------------------------------------
# Timeouts and refunds
# ---------------------------------------------------------------------------
def test_expire_job_refunds_escrow_and_bonds(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] the application window is still open"):
            contract.expire_job(job_id)
    jump(direct_vm, 8)
    with as_user(direct_vm, direct_bob):
        assert contract.expire_job(job_id) == "EXPIRED"
    assert contract.get_job(job_id)["status"] == "EXPIRED"
    assert credit(contract, direct_alice) == 10 * GEN
    assert credit(contract, direct_bob) == REFERRAL_BOND


def test_cancel_job_refunds_the_employer_only(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy(direct_deploy)
    job_id = post(direct_vm, contract, direct_alice)
    refer(direct_vm, contract, direct_bob, job_id, direct_charlie)
    with as_user(direct_vm, direct_bob):
        with direct_vm.expect_revert("[EXPECTED] only the employer can cancel"):
            contract.cancel_job(job_id)
    with as_user(direct_vm, direct_alice):
        assert contract.cancel_job(job_id) == "CANCELLED"
    assert credit(contract, direct_alice) == 10 * GEN
    assert credit(contract, direct_bob) == REFERRAL_BOND
    assert contract.get_job(job_id)["status"] == "CANCELLED"


def test_unfulfilled_hire_refunds_after_the_grace_period(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    jump(direct_vm, 16)
    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] the delivery deadline has not lapsed"):
            contract.refund_unfulfilled(job_id)
    jump(direct_vm, 18)
    with as_user(direct_vm, direct_alice):
        assert contract.refund_unfulfilled(job_id) == "UNFULFILLED"
    assert credit(contract, direct_alice) == 10 * GEN
    assert credit(contract, direct_bob) == REFERRAL_BOND
    assert contract.get_profile(hx(direct_charlie))["candidate_no_shows"] == 1


# ---------------------------------------------------------------------------
# Portable reputation
# ---------------------------------------------------------------------------
def test_passport_is_a_stable_signed_summary(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    jump(direct_vm, 4)
    settle(direct_vm, contract, direct_alice, job_id)
    passport = contract.get_passport(hx(direct_charlie))
    assert passport["protocol"] == "portico"
    assert passport["version"] == "1"
    assert passport["account"] == hx(direct_charlie)
    assert passport["candidate"]["jobs"] == 1
    assert passport["candidate"]["passes"] == 1
    assert passport["score"] > 500
    assert passport["digest"].startswith("0x")
    assert len(passport["digest"]) == 66
    # The digest is a function of the state, so it is stable between reads.
    assert contract.get_passport(hx(direct_charlie))["digest"] == passport["digest"]
    referrer = contract.get_passport(hx(direct_bob))
    assert referrer["referrer"]["hires"] == 1
    assert referrer["referrer"]["successes"] == 1


def test_a_failed_delivery_lowers_reputation(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, delivery=DELIVERY_FAIL
    )
    jump(direct_vm, 4)
    settle(direct_vm, contract, direct_alice, job_id)
    profile = contract.get_profile(hx(direct_charlie))
    assert profile["candidate_fails"] == 1
    assert profile["score"] < 500


# ---------------------------------------------------------------------------
# Board pagination
# ---------------------------------------------------------------------------
def test_job_board_returns_newest_first(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_deploy)
    first = post(direct_vm, contract, direct_alice, mode="OPEN")
    second = post(direct_vm, contract, direct_alice, mode="OPEN")
    board = contract.list_jobs(0, 10)
    assert [row["job_id"] for row in board] == [second, first]
    assert [row["job_id"] for row in contract.list_jobs(1, 10)] == [first]
    by_employer = contract.list_jobs_by_employer(hx(direct_alice), 0, 10)
    assert len(by_employer) == 2


# ---------------------------------------------------------------------------
# Adversarial recovery and consensus binding
# ---------------------------------------------------------------------------
def test_a_stalled_delivery_can_be_refunded_by_the_employer(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, deliverable_status=404
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    for _ in range(4):
        assert adjudicate(direct_vm, contract, direct_alice, job_id) == "UNDETERMINED"

    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] the recovery window is still open"):
            contract.recover_stalled_escrow(job_id)

    jump(direct_vm, 8)
    with as_user(direct_vm, direct_alice):
        assert contract.recover_stalled_escrow(job_id) == "STALLED"

    job = contract.get_job(job_id)
    assert job["status"] == "STALLED"
    assert job["verdict"] == ""
    assert job["employer_refund_atto"] == 10 * GEN
    assert credit(contract, direct_alice) == 10 * GEN
    assert credit(contract, direct_bob) == REFERRAL_BOND
    assert credit(contract, direct_charlie) == 0
    assert contract.get_stats()["jobs_stalled"] == 1
    profile = contract.get_profile(hx(direct_charlie))
    assert profile["candidate_stalled"] == 1
    assert profile["candidate_jobs"] == 0

    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] this job has no stalled delivery"):
            contract.recover_stalled_escrow(job_id)


def test_stalled_recovery_needs_a_party_and_the_grace(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, deliverable_status=404
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    assert adjudicate(direct_vm, contract, direct_alice, job_id) == "UNDETERMINED"
    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] the recovery window is still open"):
            contract.recover_stalled_escrow(job_id)

    jump(direct_vm, 8)
    with as_user(direct_vm, direct_bob):
        with direct_vm.expect_revert("[EXPECTED] only the employer or the applicant can recover"):
            contract.recover_stalled_escrow(job_id)


def test_the_applicant_can_also_close_a_stalled_delivery(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, deliverable_status=404
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    for _ in range(4):
        assert adjudicate(direct_vm, contract, direct_alice, job_id) == "UNDETERMINED"
    jump(direct_vm, 8)
    with as_user(direct_vm, direct_charlie):
        assert contract.recover_stalled_escrow(job_id) == "STALLED"
    assert credit(contract, direct_alice) == 10 * GEN


def test_appeal_cannot_resolve_before_the_other_party_is_heard(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    bond = 10 * GEN * 500 // BPS
    with as_user(direct_vm, direct_alice, bond):
        assert contract.appeal(job_id, "The tests are missing.") == "APPEALED"

    with as_user(direct_vm, direct_alice):
        with direct_vm.expect_revert("[EXPECTED] the other party's reply window is still open"):
            contract.resolve_appeal(job_id)
        with direct_vm.expect_revert("[EXPECTED] an appellant cannot answer its own appeal"):
            contract.reply_to_appeal(job_id, "I withdraw my objection.")

    with as_user(direct_vm, direct_bob):
        with direct_vm.expect_revert("[EXPECTED] only the parties can answer an appeal"):
            contract.reply_to_appeal(job_id, "As the referrer I have a view.")

    with as_user(direct_vm, direct_charlie):
        assert contract.reply_to_appeal(job_id, "The tests are in the repository root.") == "APPEALED"
        with direct_vm.expect_revert("[EXPECTED] the other party already answered"):
            contract.reply_to_appeal(job_id, "One more point.")

    # With both authenticated cases on file, the panel can resolve immediately.
    with as_user(direct_vm, direct_bob):
        assert contract.resolve_appeal(job_id) == "PASS"
    job = contract.get_job(job_id)
    assert job["appeal_replier"] == hx(direct_charlie)
    assert job["appeal_reply"].startswith("The tests are in the repository root.")


def test_an_unanswered_appeal_resolves_after_the_reply_window(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    bond = 10 * GEN * 500 // BPS
    with as_user(direct_vm, direct_charlie, bond):
        assert contract.appeal(job_id, "The delivery met every criterion.") == "APPEALED"
    job = contract.get_job(job_id)
    assert job["appeal_reply_deadline"] == int(BASE.timestamp()) + 2 * 86_400

    jump(direct_vm, 3)
    with as_user(direct_vm, direct_alice):
        assert contract.resolve_appeal(job_id) == "PASS"
    assert contract.get_job(job_id)["appeal_resolved"] is True


def test_a_pass_without_a_citation_is_void(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    uncited = dict(DELIVERY_PASS, cited_sources=[])
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, delivery=uncited
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    assert adjudicate(direct_vm, contract, direct_alice, job_id) == "UNDETERMINED"
    job = contract.get_job(job_id)
    assert job["verdict"] == ""
    assert job["status"] == "DELIVERED"
    assert "did not cite a fetched source" in job["rationale"]
    assert contract.get_stats()["adjudications_unreadable"] == 1


def test_a_pass_always_pays_the_full_ratio(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    near_pass = dict(DELIVERY_PASS, payout_ratio_bps=9_200)
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, delivery=near_pass
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    assert adjudicate(direct_vm, contract, direct_alice, job_id) == "PASS"
    assert contract.get_job(job_id)["payout_ratio_bps"] == 10_000


def test_a_partial_is_snapped_to_the_ratio_bucket(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    near_partial = dict(DELIVERY_PARTIAL, payout_ratio_bps=8_600)
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, delivery=near_partial
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    assert adjudicate(direct_vm, contract, direct_alice, job_id) == "PARTIAL"
    assert contract.get_job(job_id)["payout_ratio_bps"] == 8_500


def test_a_tiny_partial_is_raised_to_the_minimum_bucket(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    tiny_partial = dict(DELIVERY_PARTIAL, payout_ratio_bps=200)
    contract, job_id = hired_job(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, delivery=tiny_partial
    )
    deliver(direct_vm, contract, direct_charlie, job_id)
    assert adjudicate(direct_vm, contract, direct_alice, job_id) == "PARTIAL"
    assert contract.get_job(job_id)["payout_ratio_bps"] == 500


def test_settlement_conserves_escrow_and_bonds(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    jump(direct_vm, 4)
    settle(direct_vm, contract, direct_alice, job_id)
    entries = contract.list_job_ledger(job_id, 0, 50)
    booked = sum(entry["amount_atto"] for entry in entries)
    assert booked == 10 * GEN + REFERRAL_BOND
    paid = (
        credit(contract, direct_charlie)
        + credit(contract, direct_bob)
        + credit(contract, direct_alice)
        + credit(contract, direct_owner)
    )
    assert paid == booked
    job = contract.get_job(job_id)
    assert (
        job["candidate_paid_atto"]
        + job["referrer_paid_atto"]
        + job["fee_paid_atto"]
        + job["employer_refund_atto"]
        == 10 * GEN
    )


def test_the_owner_can_withdraw_the_protocol_fee(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
    contract, job_id = verdict_job(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    jump(direct_vm, 4)
    settle(direct_vm, contract, direct_alice, job_id)
    fee = 10 * GEN * 300 // BPS
    assert credit(contract, direct_owner) == fee
    with as_user(direct_vm, direct_owner):
        assert contract.withdraw() == fee
    assert credit(contract, direct_owner) == 0
