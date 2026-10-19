# Local verification report

Date: 2026-10-19

## Results

- `py -m pytest -q -p no:cacheprovider`: **7 passed** (GenLayer Direct Mode).
- `py -m pytest -q`: **7 passed**. The revised suite uses a fixed Forum record
  plus the Snapshot GraphQL proposal response rather than proposals.app.
- `genvm-lint check contracts/unlock_check.py`: **passed**; schema found
  `UnlockCheck` with 3 views and 1 write.
- `npm run build` in `frontend/`: **passed** (TypeScript + Vite production build;
  Vite reported only its existing large-chunk warning).
- Local browser preview: inspected with the supplied StudioNet address; logo and
  zero-receipt state rendered correctly.

## Test source classification

Every successful source/RPC path in Direct Mode uses synthetic Forum, Snapshot,
vesting and address-page bytes plus a mocked Arbitrum JSON-RPC response. Those paths
test application logic only; they are not evidence that the cited Arbitrum
sources or live chain state were verified. Failure tests also use controlled
unavailable-source and wrong-chain responses. Sources are listed in
`SOURCE_AND_EVIDENCE.md` and will be fetched again by validators in a real
assessment.

Covered behaviors: `MATCH`, onchain `MISMATCH`, changed Snapshot epoch
fail-closed, independent validator re-fetch, changed-source rejection, wrong-chain
fail-closed, unavailable-source retry, permissionless different-wallet submit,
sender-scoped request IDs, and duplicate prevention.

## Live StudioNet verification

- Current StudioNet address: `0xf95DB72FACA2B08732B391977dd2f13FaA58Ca8d`.
- It is a pre-existing owner-designated deployment; no deployment transaction is
  claimed without an owner-supplied hash.
- Deployed source and local source match byte-for-byte: 18,897 UTF-8 bytes,
  SHA-256 `6764e0c9476a44b04e002df8a374f35339d331a1389ecc92927b2c047bf8d01e`.
- Live SDK E2E used `dbl-owner` (`0xeb57…3581f8`) and `dbl-adapter`
  (`0x2da5…fc843f`): four writes finalized `SUCCESS` and produced caller-scoped
  `MATCH` receipts; invalid input and duplicate replay both finalized `ERROR`
  without changing the receipt count. `receipt_count` changed from 0 to 4.
- The receipts prove a live source/RPC path: `start()` was read at finalized
  Arbitrum block 516223544 and matched 1681754400. Full transaction and source
  digest evidence is in [`docs/live-evidence/studionet-f95-live-e2e.json`](live-evidence/studionet-f95-live-e2e.json).
- Browser-extension signing remains untested; the live writes used the SDK and
  signer keys from the CLI OS keychain, in memory only.
- Direct Mode cannot establish chain rollback after consensus disagreement; run
  a GenVM/Studio integration test for that property.

Historical failed deployments remain documented separately; do not represent them
as positive evidence. The current final deployment and two-wallet run are the
submission evidence.
