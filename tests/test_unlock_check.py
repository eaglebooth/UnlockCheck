import json


FORUM_URL = "https://forum.arbitrum.foundation/t/proposal-aip-1-1-lockup-budget-transparency/13360"
SNAPSHOT_GRAPHQL_URL = "https://hub.snapshot.org/graphql"
SNAPSHOT_PROPOSAL_ID = "0x7203289844e807781e8d2ec110d4b97a79a29944cae06a52dbe315a16381a2ae"
VESTING_URL = "https://docs.arbitrum.foundation/airdrop-eligibility-distribution"
ADDRESS_URL = "https://docs.arbitrum.foundation/deployment-addresses"
WALLET = "0x15533b77981cda0f85c4f9a485237df4285d6844"
TOKEN = "0x912ce59144191c1204e64559fe8253a0e49e6548"
BLOCK_HASH = "0x" + "ab" * 32


def install_synthetic_sources(direct_vm, onchain_start=1681754400, *, snapshot_end=1681754400, forum_suffix="", forum_text=None, rpc_chain_id="0xa4b1"):
    pages = {
        FORUM_URL: (forum_text if forum_text is not None else "AIP-1.1 was live on Snapshot and the correctly setup one can be viewed at Tally.") + forum_suffix,
        VESTING_URL: "Arbitrum Foundation vesting linearly unlock begins 2023-04-17 for four years.",
        ADDRESS_URL: f"Foundation Vesting Budget Smart Contract Wallet {WALLET}; token {TOKEN}.",
    }

    def live_web(request):
        url, method = request.get("url", ""), request.get("method", "GET")
        if method == "GET":
            body = pages[url].encode("utf-8")
            return {"ok": {"response": {"status": 200, "headers": {}, "body": body}}}
        payload = request.get("body")
        if isinstance(payload, bytes):
            payload = json.loads(payload.decode("utf-8"))
        elif isinstance(payload, str):
            payload = json.loads(payload)
        if url == SNAPSHOT_GRAPHQL_URL:
            body = json.dumps({"data": {"proposal": {
                "id": SNAPSHOT_PROPOSAL_ID,
                "title": "AIP-1.1 - Lockup, Budget, Transparency",
                "state": "closed",
                "end": snapshot_end,
                "space": {"id": "arbitrumfoundation.eth"},
            }}}).encode("utf-8")
            return {"ok": {"response": {"status": 200, "headers": {}, "body": body}}}
        method_name = payload.get("method") if isinstance(payload, dict) else ""
        if method_name == "eth_chainId":
            result = rpc_chain_id
        elif method_name == "eth_getBlockByNumber":
            result = {"number": "0x64", "hash": BLOCK_HASH}
        elif method_name == "eth_getCode":
            result = "0x6001600055"
        elif method_name == "eth_call":
            result = "0x" + format(onchain_start, "064x")
        else:
            raise AssertionError(f"unexpected synthetic RPC method {method_name}")
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": result}).encode("utf-8")
        return {"ok": {"response": {"status": 200, "headers": {}, "body": body}}}

    direct_vm._live_web_handler = live_web
def test_schema_loads_with_no_deployer_privilege(direct_deploy):
    contract = direct_deploy("contracts/unlock_check.py")
    assert json.loads(contract.get_stats()) == {"receipt_count": 0}


def test_permissionless_assessment_and_independent_validator(direct_deploy, direct_vm, direct_alice, direct_bob):
    contract = direct_deploy("contracts/unlock_check.py")
    install_synthetic_sources(direct_vm)

    with direct_vm.prank(direct_alice):
        assert contract.assess("test-request-0001") == "1"
    assert direct_vm.run_validator()
    receipt = json.loads(contract.get_receipt_for("0x" + bytes(direct_alice).hex(), "test-request-0001"))
    assert receipt["status"] == "MATCH"
    assert receipt["assessor"].lower() == "0x" + bytes(direct_alice).hex()
    assert receipt["effective_start"] == receipt["observed_start"] == 1681754400
    assert receipt["block_number"] == 100
    assert len(receipt["evidence_digest"]) == 64
    with direct_vm.prank(direct_alice), direct_vm.expect_revert("REQUEST_ALREADY_ASSESSED"):
        contract.assess("test-request-0001")

    # No deployer/case-owner gate: a different wallet can submit a mismatch.
    install_synthetic_sources(direct_vm, 1681754401)
    with direct_vm.prank(direct_bob):
        assert contract.assess("test-request-0001") == "2"
    assert direct_vm.run_validator()
    mismatch = json.loads(contract.get_receipt_for("0x" + bytes(direct_bob).hex(), "test-request-0001"))
    assert mismatch["status"] == "MISMATCH"
    assert mismatch["assessor"].lower() == "0x" + bytes(direct_bob).hex()


def test_changed_snapshot_epoch_fails_closed_without_receipt(direct_deploy, direct_vm, direct_alice):
    contract = direct_deploy("contracts/unlock_check.py")
    install_synthetic_sources(direct_vm, snapshot_end=1681754401)
    with direct_vm.prank(direct_alice), direct_vm.expect_revert("ASSESSMENT_UNAVAILABLE_RETRY"):
        contract.assess("changed-snapshot-01")
    assert json.loads(contract.get_stats()) == {"receipt_count": 0}


def test_semantically_changed_source_between_leader_and_validator_is_rejected(direct_deploy, direct_vm, direct_alice):
    contract = direct_deploy("contracts/unlock_check.py")
    install_synthetic_sources(direct_vm)
    with direct_vm.prank(direct_alice):
        contract.assess("tamper-request-01")
    assert direct_vm.run_validator()

    # A cosmetic byte difference is not a disagreement. But if a validator's
    # independently fetched Forum source no longer binds the corrected AIP,
    # it rejects the leader's semantic result.
    install_synthetic_sources(direct_vm, forum_text="AIP-1.1 was discussed on Snapshot, but no corrected configuration is identified.")
    assert not direct_vm.run_validator()


def test_wrong_rpc_chain_fails_closed_without_receipt(direct_deploy, direct_vm, direct_alice):
    contract = direct_deploy("contracts/unlock_check.py")
    install_synthetic_sources(direct_vm, rpc_chain_id="0x1")
    with direct_vm.prank(direct_alice), direct_vm.expect_revert("ASSESSMENT_UNAVAILABLE_RETRY"):
        contract.assess("wrong-chain-req-01")
    assert json.loads(contract.get_stats()) == {"receipt_count": 0}


def test_unavailable_source_is_retryable_and_does_not_append(direct_deploy, direct_vm, direct_alice, direct_bob):
    contract = direct_deploy("contracts/unlock_check.py")
    direct_vm.mock_web(
        r"forum\.arbitrum\.foundation/t/proposal-aip-1-1-lockup-budget-transparency/13360",
        {"method": "GET", "status": 503, "body": "upstream unavailable"},
    )

    with direct_vm.prank(direct_alice), direct_vm.expect_revert("ASSESSMENT_UNAVAILABLE_RETRY"):
        contract.assess("failed-request-01")
    assert json.loads(contract.get_stats()) == {"receipt_count": 0}

    # There is no mutable/open study keyed by the first caller: an unrelated wallet
    # can retry later and is not locked out by the failed attempt.
    with direct_vm.prank(direct_bob), direct_vm.expect_revert("ASSESSMENT_UNAVAILABLE_RETRY"):
        contract.assess("failed-request-01")
    assert json.loads(contract.get_stats()) == {"receipt_count": 0}


def test_no_positive_receipt_can_be_forged_by_calling_a_view(direct_deploy, direct_vm, direct_alice):
    contract = direct_deploy("contracts/unlock_check.py")
    with direct_vm.expect_revert("RECEIPT_NOT_FOUND"):
        contract.get_receipt("1")
    assert json.loads(contract.get_stats()) == {"receipt_count": 0}
