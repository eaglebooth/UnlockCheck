# UnlockCheck — live StudioNet E2E evidence

Run: `f95-live-e2e` on 2026-10-19. This is a signed GenLayerJS SDK run using
the two designated auxiliary accounts. Private keys were read in memory from the
GenLayer CLI OS keychain; they were not written to the repository or console.

- Network: GenLayer StudioNet, chain ID `61999`.
- Owner-designated, pre-existing contract:
  [`0xf95DB72FACA2B08732B391977dd2f13FaA58Ca8d`](https://explorer-studio.genlayer.com/address/0xf95DB72FACA2B08732B391977dd2f13FaA58Ca8d).
- No deployment hash is asserted because it was not supplied for this contract.
- Deployed source and local `contracts/unlock_check.py` are byte-for-byte equal:
  18,897 UTF-8 bytes, SHA-256
  `6764e0c9476a44b04e002df8a374f35339d331a1389ecc92927b2c047bf8d01e`.
- Exact finalized `get_stats()` readback moved `receipt_count` from `0` to `4`.

## Happy path and adversarial isolation

| Scenario | Signer | Outcome | State proof |
|---|---|---|---|
| Happy path A | `dbl-owner` | [`FINALIZED / SUCCESS`](https://explorer-studio.genlayer.com/tx/0xb33bc5385352c91d873c93dcfb82343e8757d363df3cafe06d1ca0250ed29ca6) | Receipt `1`, `MATCH`, count `0 → 1` |
| Happy path B | `dbl-adapter` | [`FINALIZED / SUCCESS`](https://explorer-studio.genlayer.com/tx/0x910ceeb9be1d81e93f818e72abda6c8310e227f695178cf9a77212c8fc4dc258) | Receipt `2`, `MATCH`, count `1 → 2` |
| Shared request ID, wallet A | `dbl-owner` | [`FINALIZED / SUCCESS`](https://explorer-studio.genlayer.com/tx/0xda8f1648f99739a28cb5507ad66527b54c7725139774ac428c0f8fd3046f0ab2) | Receipt `3`, `MATCH`, count `2 → 3` |
| Same shared request ID, wallet B | `dbl-adapter` | [`FINALIZED / SUCCESS`](https://explorer-studio.genlayer.com/tx/0xc9b4b6c061db7207fc41669446129123532a8da84473a8879738838672fb565e) | Receipt `4`, `MATCH`, count `3 → 4` |

The shared-ID pair is the adversarial authorization check: the contract scopes
request identity by `sender + request_id`. A request submitted by wallet A did
not reserve, overwrite, or block wallet B’s use of the identical request ID.

Every positive receipt records `effective_start = observed_start = 1681754400`,
the finalized Arbitrum One block `516227582`, its block hash, vesting-wallet
code hash, source response hashes/byte lengths, and an evidence digest. Forum
HTML hashes may differ between independent executions because its wrapper bytes
are volatile; validators independently check the fixed semantic anchors and the
pinned chain fact rather than falsely rejecting on that expected byte variance.

## Failure and conflict paths

| Scenario | Outcome | No-mutation proof |
|---|---|---|
| Replay A’s completed request | [`FINALIZED / ERROR`](https://explorer-studio.genlayer.com/tx/0x496e22bcb488d9110993521e422ef80f0b9535f13396d33d758de3c31a76648b) | Count stays `1`; original receipt `1` remains readable. |
| Invalid request ID from B | [`FINALIZED / ERROR`](https://explorer-studio.genlayer.com/tx/0x951ca551a200b6d48fb65e89e32efcfd107441fd3cb0b61d590c2f17086ccf2d) | Count stays `1`; no caller-scoped receipt exists. |
| Additional B duplicate-retry guard | [`FINALIZED / ERROR`](https://explorer-studio.genlayer.com/tx/0x78b40efe6d29f2df1ec050c16ea52586e6431d3f54eeabc9f040bfaff850f502) | Final receipt reports `REQUEST_ALREADY_ASSESSED`; it did not append a receipt. |

These failure results are intentional safety behavior, not successful
assessments. They demonstrate a rejected replay cannot mutate an existing
receipt and malformed input cannot create an entry.

## UI alignment

The frontend is configured for this contract. A fresh read-only browser check
rendered registered receipts `4`, latest receipt `#0004`, `MATCH`, its assessor,
finalized block `516227582`, evidence digest, and source commitments — all
matching `get_stats()` and `get_receipt("4")` finalized contract reads.

Machine-readable transaction, validator, assertion, and readback evidence:
[`live-evidence/studionet-f95-live-e2e.json`](live-evidence/studionet-f95-live-e2e.json).

## Historical deployments

Older evidence JSON files remain in `live-evidence/` for diagnostic traceability.
They refer to other deployments and are not part of this contract’s positive
evidence.
