# v0.2.17
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import hashlib
import json
import re
import typing
from dataclasses import dataclass


# This contract intentionally verifies one bounded, public claim only:
# the corrected Arbitrum Foundation vesting-wallet start epoch.
CHAIN_ID = 42161
RPC_URL = "https://arb1.arbitrum.io/rpc"
WALLET = "0x15533b77981cDa0F85c4F9a485237DF4285D6844"
TOKEN = "0x912CE59144191C1204E64559FE8253a0e49E6548"
START_SELECTOR = "0xbe9a6555"  # keccak256("start()")[:4]
EXPECTED_START = 1681754400
# The former proposals.app page was factually useful but unavailable to a live
# GenVM leader.  These two fixed public sources separate the two assertions:
# the Arbitrum Forum binds AIP-1.1 to the official Snapshot vote, while the
# Snapshot Hub returns that vote's closed epoch directly.
FORUM_URL = "https://forum.arbitrum.foundation/t/proposal-aip-1-1-lockup-budget-transparency/13360"
SNAPSHOT_GRAPHQL_URL = "https://hub.snapshot.org/graphql"
SNAPSHOT_PROPOSAL_ID = "0x7203289844e807781e8d2ec110d4b97a79a29944cae06a52dbe315a16381a2ae"
SNAPSHOT_SPACE = "arbitrumfoundation.eth"
VESTING_URL = "https://docs.arbitrum.foundation/airdrop-eligibility-distribution"
ADDRESS_URL = "https://docs.arbitrum.foundation/deployment-addresses"
MAX_SOURCE_BYTES = 350000


@allow_storage
@dataclass
class Receipt:
    receipt_id: str
    assessor: str
    status: str
    effective_start: bigint
    observed_start: bigint
    block_number: bigint
    block_hash: str
    code_hash: str
    forum_sha256: str
    forum_bytes: bigint
    snapshot_sha256: str
    snapshot_bytes: bigint
    vesting_doc_sha256: str
    vesting_doc_bytes: bigint
    address_doc_sha256: str
    address_doc_bytes: bigint
    evidence_digest: str


def _canonical(value: typing.Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _hex_int(value: typing.Any) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]+", value):
        raise ValueError("RPC_HEX_INVALID")
    return int(value, 16)


def _request_id(value: str) -> str:
    text = str(value or "").strip().lower()
    if 8 <= len(text) <= 72 and all(("a" <= char <= "z") or ("0" <= char <= "9") or char in "-_" for char in text):
        return text
    return ""


def _body_bytes(response: typing.Any) -> bytes:
    body = getattr(response, "body", None)
    if isinstance(body, bytes):
        raw = body
    elif isinstance(body, str):
        raw = body.encode("utf-8")
    else:
        raise ValueError("SOURCE_BODY_INVALID")
    if not raw or len(raw) > MAX_SOURCE_BYTES:
        raise ValueError("SOURCE_SIZE_INVALID")
    return raw


def _page(url: str) -> typing.Tuple[str, str, int]:
    response = gl.nondet.web.get(url)
    status = int(getattr(response, "status_code", getattr(response, "status", 0)))
    if status < 200 or status >= 300:
        raise ValueError("SOURCE_UNAVAILABLE")
    raw = _body_bytes(response)
    try:
        text = raw.decode("utf-8")
    except Exception:
        raise ValueError("SOURCE_ENCODING_INVALID")
    # Keep exact raw bytes committed while using deterministic readable text for
    # bounded source-anchor checks.  There is no LLM prompt-size restriction.
    readable = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    readable = re.sub(r"(?s)<[^>]+>", " ", readable)
    readable = re.sub(r"&nbsp;|&#160;", " ", readable)
    readable = re.sub(r"&amp;", "&", readable)
    readable = re.sub(r"&lt;", "<", readable)
    readable = re.sub(r"&gt;", ">", readable)
    readable = re.sub(r"&quot;|&#34;", '"', readable)
    readable = re.sub(r"&#39;|&apos;", "'", readable)
    readable = re.sub(r"\s+", " ", readable).strip()
    return hashlib.sha256(raw).hexdigest(), readable, len(raw)


def _snapshot_approval() -> typing.Tuple[str, int, int]:
    # Snapshot is queried by its immutable proposal ID.  The response itself is
    # committed to the receipt so a reviewer can independently inspect exactly
    # what the leader and validators relied on.
    query = (
        'query { proposal(id: "' + SNAPSHOT_PROPOSAL_ID +
        '") { id title state end space { id } } }'
    )
    response = gl.nondet.web.request(
        SNAPSHOT_GRAPHQL_URL,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        body=json.dumps({"query": query}, separators=(",", ":")).encode("utf-8"),
    )
    status = int(getattr(response, "status_code", getattr(response, "status", 0)))
    if status < 200 or status >= 300:
        raise ValueError("SNAPSHOT_UNAVAILABLE")
    raw = _body_bytes(response)
    try:
        payload = json.loads(raw.decode("utf-8"))
        proposal = payload["data"]["proposal"]
    except Exception:
        raise ValueError("SNAPSHOT_RESPONSE_INVALID")
    if not isinstance(proposal, dict):
        raise ValueError("SNAPSHOT_RESPONSE_INVALID")
    space = proposal.get("space")
    proposal_id = proposal.get("id")
    title = proposal.get("title")
    state = proposal.get("state")
    end = proposal.get("end")
    if (
        not isinstance(space, dict) or str(space.get("id", "")).lower() != SNAPSHOT_SPACE or
        str(proposal_id).lower() != SNAPSHOT_PROPOSAL_ID or not isinstance(title, str) or
        "aip-1.1" not in title.lower() or str(state).lower() != "closed" or
        type(end) is not int or end < 0
    ):
        raise ValueError("SNAPSHOT_IDENTITY_INVALID")
    return hashlib.sha256(raw).hexdigest(), end, len(raw)


def _rpc(method: str, params: list) -> typing.Any:
    response = gl.nondet.web.request(
        RPC_URL,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        body=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, separators=(",", ":")).encode("utf-8"),
    )
    status = int(getattr(response, "status_code", getattr(response, "status", 0)))
    if status < 200 or status >= 300:
        raise ValueError("RPC_UNAVAILABLE")
    body = getattr(response, "body", None)
    if isinstance(body, bytes):
        body = body.decode("utf-8")
    if not isinstance(body, str):
        raise ValueError("RPC_BODY_INVALID")
    payload = json.loads(body)
    if not isinstance(payload, dict) or payload.get("error") or "result" not in payload:
        raise ValueError("RPC_RESPONSE_INVALID")
    return payload["result"]


def _observe(block_number: typing.Optional[int] = None) -> typing.Dict[str, typing.Any]:
    chain_id = _hex_int(_rpc("eth_chainId", []))
    if chain_id != CHAIN_ID:
        raise ValueError("RPC_WRONG_CHAIN")
    if block_number is None:
        block = _rpc("eth_getBlockByNumber", ["finalized", False])
        if not isinstance(block, dict) or not isinstance(block.get("number"), str):
            raise ValueError("FINALIZED_BLOCK_UNAVAILABLE")
        block_number = _hex_int(block["number"])
        block_hash = block.get("hash", "")
    else:
        finalized = _rpc("eth_getBlockByNumber", ["finalized", False])
        if not isinstance(finalized, dict) or _hex_int(finalized.get("number")) < block_number:
            raise ValueError("PINNED_BLOCK_NOT_FINALIZED")
        block = _rpc("eth_getBlockByNumber", [hex(block_number), False])
        if not isinstance(block, dict):
            raise ValueError("PINNED_BLOCK_UNAVAILABLE")
        block_hash = block.get("hash", "")
    if not isinstance(block_hash, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", block_hash):
        raise ValueError("BLOCK_HASH_INVALID")
    code = _rpc("eth_getCode", [WALLET, hex(block_number)])
    if not isinstance(code, str) or not re.fullmatch(r"0x[0-9a-fA-F]+", code) or code == "0x":
        raise ValueError("WALLET_CODE_UNAVAILABLE")
    call_data = _rpc("eth_call", [{"to": WALLET, "data": START_SELECTOR}, hex(block_number)])
    if not isinstance(call_data, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", call_data):
        raise ValueError("START_CALL_INVALID")
    return {
        "chain_id": chain_id,
        "wallet": WALLET.lower(),
        "token": TOKEN.lower(),
        "block_number": block_number,
        "block_hash": block_hash.lower(),
        "code_hash": hashlib.sha256(bytes.fromhex(code[2:])).hexdigest(),
        "observed_start": int(call_data, 16),
    }


def _confirm_sources(forum: str, snapshot_end: int, vesting: str, addresses: str) -> typing.Dict[str, typing.Any]:
    forum_lower = forum.lower()
    vesting_lower = vesting.lower()
    addresses_lower = addresses.lower()
    vesting_identity = (
        WALLET.lower() in addresses_lower and TOKEN.lower() in addresses_lower and
        "linearly unlock" in vesting_lower and
        ("four years" in vesting_lower or "four-year" in vesting_lower or "4 years" in vesting_lower) and
        any(date_text in vesting_lower for date_text in ("4/17/2023", "04/17/2023", "2023-04-17", "17 april 2023", "april 17, 2023"))
    )
    # The Forum identifies the corrected AIP-1.1 vote as the applicable vote;
    # Snapshot supplies the approval epoch.  The values are deliberately checked
    # independently, not inferred from prose or accepted from a caller.
    forum_identity = (
        "aip-1.1" in forum_lower and "snapshot" in forum_lower and
        ("correctly setup" in forum_lower or "correctly set" in forum_lower or "correct configuration" in forum_lower)
    )
    if not vesting_identity or not forum_identity:
        raise ValueError("SOURCE_EVIDENCE_ANCHOR_MISSING")
    if snapshot_end != EXPECTED_START:
        # Do not silently accept a materially changed publication: require a deliberate update.
        raise ValueError("SOURCE_EFFECTIVE_START_CHANGED")
    return {"effective_start": snapshot_end, "source_confirmed": True}


class UnlockCheck(gl.Contract):
    receipts: TreeMap[str, Receipt]
    request_receipts: TreeMap[str, str]
    request_exists: TreeMap[str, bool]
    receipt_count: bigint

    def __init__(self):
        self.receipt_count = bigint(0)

    @gl.public.write
    def assess(self, request_id: str) -> str:
        assessor = str(gl.message.sender_address).lower()
        request = _request_id(request_id)
        if not request:
            raise gl.vm.UserError("INVALID_REQUEST_ID")
        request_key = assessor + ":" + request
        if bool(self.request_exists.get(request_key, False)):
            raise gl.vm.UserError("REQUEST_ALREADY_ASSESSED")
        next_id = int(self.receipt_count) + 1
        receipt_id = str(next_id)

        def leader_fn() -> str:
            f_hash, forum, f_bytes = _page(FORUM_URL)
            s_hash, snapshot_end, s_bytes = _snapshot_approval()
            v_hash, vesting, v_bytes = _page(VESTING_URL)
            a_hash, addresses, a_bytes = _page(ADDRESS_URL)
            observed = _observe()
            interpreted = _confirm_sources(forum, snapshot_end, vesting, addresses)
            status = "AMBIGUOUS" if not interpreted["source_confirmed"] else (
                "MATCH" if observed["observed_start"] == interpreted["effective_start"] else "MISMATCH"
            )
            result = {
                "source": {"forum": f_hash, "forum_bytes": f_bytes, "snapshot": s_hash, "snapshot_bytes": s_bytes, "vesting": v_hash, "vesting_bytes": v_bytes, "addresses": a_hash, "address_bytes": a_bytes},
                "chain": observed,
                "effective_start": interpreted["effective_start"],
                "source_confirmed": interpreted["source_confirmed"],
                "status": status,
            }
            return _canonical(result)

        def validator_fn(leader_result: typing.Any) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                proposed = json.loads(leader_result.calldata)
                if set(proposed.keys()) != {"source", "chain", "effective_start", "source_confirmed", "status"}:
                    return False
                source = proposed.get("source")
                if (
                    not isinstance(source, dict) or
                    set(source.keys()) != {"forum", "forum_bytes", "snapshot", "snapshot_bytes", "vesting", "vesting_bytes", "addresses", "address_bytes"} or
                    any(not isinstance(source.get(key), str) or not re.fullmatch(r"[0-9a-f]{64}", source[key]) for key in ("forum", "snapshot", "vesting", "addresses")) or
                    any(type(source.get(key)) is not int or source[key] < 1 or source[key] > MAX_SOURCE_BYTES for key in ("forum_bytes", "snapshot_bytes", "vesting_bytes", "address_bytes"))
                ):
                    return False
                pinned_block = int(proposed["chain"]["block_number"])
                f_hash, forum, f_bytes = _page(FORUM_URL)
                s_hash, snapshot_end, s_bytes = _snapshot_approval()
                v_hash, vesting, v_bytes = _page(VESTING_URL)
                a_hash, addresses, a_bytes = _page(ADDRESS_URL)
                observed = _observe(pinned_block)
                interpreted = _confirm_sources(forum, snapshot_end, vesting, addresses)
                status = "AMBIGUOUS" if not interpreted["source_confirmed"] else (
                    "MATCH" if observed["observed_start"] == interpreted["effective_start"] else "MISMATCH"
                )
                # Source bytes can legitimately vary between independent web
                # requests (for example, a Forum page may include volatile HTML
                # wrappers). Each validator re-checks its own fixed sources, but
                # consensus binds the stable semantic result and pinned chain
                # fact. The leader's exact source hashes remain in the receipt.
                independent = {
                    "chain": observed,
                    "effective_start": interpreted["effective_start"],
                    "source_confirmed": interpreted["source_confirmed"],
                    "status": status,
                }
                proposed_core = {
                    "chain": proposed["chain"],
                    "effective_start": proposed["effective_start"],
                    "source_confirmed": proposed["source_confirmed"],
                    "status": proposed["status"],
                }
                return _canonical(independent) == _canonical(proposed_core)
            except Exception:
                return False

        try:
            outcome = json.loads(gl.vm.run_nondet_unsafe(leader_fn, validator_fn))
        except Exception:
            # The failed call makes no state change. A later user or reviewer can retry.
            raise gl.vm.UserError("ASSESSMENT_UNAVAILABLE_RETRY")
        status = outcome.get("status")
        if status not in ("MATCH", "MISMATCH", "AMBIGUOUS"):
            raise gl.vm.UserError("ASSESSMENT_INVALID_RETRY")
        chain = outcome["chain"]
        source = outcome["source"]
        evidence = {
            "receipt_id": receipt_id,
            "assessor": assessor,
            "status": status,
            "effective_start": outcome["effective_start"],
            "observed_start": chain["observed_start"],
            "chain_id": chain["chain_id"],
            "wallet": chain["wallet"],
            "token": chain["token"],
            "block_number": chain["block_number"],
            "block_hash": chain["block_hash"],
            "code_hash": chain["code_hash"],
            "forum_sha256": source["forum"],
            "forum_bytes": source["forum_bytes"],
            "snapshot_sha256": source["snapshot"],
            "snapshot_bytes": source["snapshot_bytes"],
            "vesting_doc_sha256": source["vesting"],
            "vesting_doc_bytes": source["vesting_bytes"],
            "address_doc_sha256": source["addresses"],
            "address_doc_bytes": source["address_bytes"],
        }
        digest = hashlib.sha256(_canonical(evidence).encode("utf-8")).hexdigest()
        self.receipts[receipt_id] = Receipt(
            receipt_id, assessor, status, bigint(int(outcome["effective_start"])),
            bigint(int(chain["observed_start"])), bigint(int(chain["block_number"])),
            chain["block_hash"], chain["code_hash"], source["forum"], bigint(int(source["forum_bytes"])),
            source["snapshot"], bigint(int(source["snapshot_bytes"])), source["vesting"], bigint(int(source["vesting_bytes"])),
            source["addresses"], bigint(int(source["address_bytes"])), digest,
        )
        self.request_receipts[request_key] = receipt_id
        self.request_exists[request_key] = True
        self.receipt_count = bigint(next_id)
        return receipt_id

    def _receipt_json(self, item: Receipt) -> str:
        return _canonical({
            "receipt_id": str(item.receipt_id), "assessor": str(item.assessor), "status": str(item.status),
            "effective_start": int(item.effective_start), "observed_start": int(item.observed_start),
            "chain_id": CHAIN_ID, "wallet": WALLET.lower(), "token": TOKEN.lower(),
            "block_number": int(item.block_number), "block_hash": str(item.block_hash),
            "code_hash": str(item.code_hash), "forum_url": FORUM_URL,
            "snapshot_proposal_id": SNAPSHOT_PROPOSAL_ID,
            "vesting_url": VESTING_URL, "address_url": ADDRESS_URL,
            "forum_sha256": str(item.forum_sha256), "snapshot_sha256": str(item.snapshot_sha256), "vesting_doc_sha256": str(item.vesting_doc_sha256),
            "address_doc_sha256": str(item.address_doc_sha256), "forum_bytes": int(item.forum_bytes), "snapshot_bytes": int(item.snapshot_bytes),
            "vesting_doc_bytes": int(item.vesting_doc_bytes), "address_doc_bytes": int(item.address_doc_bytes),
            "evidence_digest": str(item.evidence_digest),
        })

    @gl.public.view
    def get_receipt(self, receipt_id: str) -> str:
        rid = str(receipt_id)
        if not rid.isdigit() or int(rid) < 1 or int(rid) > int(self.receipt_count):
            raise gl.vm.UserError("RECEIPT_NOT_FOUND")
        item = self.receipts[rid]
        return self._receipt_json(item)

    @gl.public.view
    def get_receipt_for(self, assessor: str, request_id: str) -> str:
        owner = str(assessor or "").strip().lower()
        if not re.fullmatch(r"0x[0-9a-f]{40}", owner):
            raise gl.vm.UserError("INVALID_ASSESSOR")
        request = _request_id(request_id)
        if not request:
            raise gl.vm.UserError("INVALID_REQUEST_ID")
        request_key = owner + ":" + request
        if not bool(self.request_exists.get(request_key, False)):
            raise gl.vm.UserError("RECEIPT_NOT_FOUND")
        return self._receipt_json(self.receipts[self.request_receipts[request_key]])

    @gl.public.view
    def get_stats(self) -> str:
        return _canonical({"receipt_count": int(self.receipt_count)})
