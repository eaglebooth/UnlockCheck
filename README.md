# UnlockCheck

UnlockCheck is a GenLayer Intelligent Contract plus a small reviewer-facing web
app. It creates permissionless, immutable receipts for one question: does the
corrected Arbitrum Foundation vesting start claim equal the vesting wallet's
`start()` getter at a recorded finalized Arbitrum One block?

This is intentionally not a full vesting audit. It does not certify all schedule
terms, safety, legal effect, balances, or future unlock behavior. See
[`docs/SOURCE_AND_EVIDENCE.md`](docs/SOURCE_AND_EVIDENCE.md) for source authority,
data boundaries, source authority, and evidence classification.

## Structure

- `contracts/unlock_check.py` — fixed-source, permissionless contract; no funds,
  roles, admin controls, or caller-provided URLs.
- `frontend/` — original interface using the supplied project logo; wallet writes
  are followed by finalized transaction checks and authoritative contract
  readback before the UI reports success.
- `tests/` — direct tests for deployed public entrypoints and retry/no-mutation.
- `fixtures/` — clearly labeled synthetic classification examples.
- `docs/` — source boundary, submission evidence requirements, test plan.

## Local checks

```powershell
py -m pytest -q
cd frontend
npm install
npm run build
```

Local mocks and synthetic examples are not live evidence.

## Frontend configuration

The supplied StudioNet contract address is configured in
`frontend/.env.example` (copy it to `frontend/.env.local` for local development).
The app connects to GenLayer StudioNet (chain ID 61999); any wallet can submit an
assessment. The deployment wallet is not required for testing, and the contract
does not store a deployer role. Do not commit wallet keys or `.env` files.

## Deployment and live evidence

The current StudioNet contract selected by the project owner is
[`0xf95DB72FACA2B08732B391977dd2f13FaA58Ca8d`](https://explorer-studio.genlayer.com/address/0xf95DB72FACA2B08732B391977dd2f13FaA58Ca8d).
No deployment transaction is asserted here because it was not supplied for this
pre-existing contract.
The deployed and workspace sources are byte-for-byte identical (18,897 UTF-8
bytes; SHA-256 `6764e0c9476a44b04e002df8a374f35339d331a1389ecc92927b2c047bf8d01e`).
The live run verifies four successful receipts plus invalid-input and replay
failure paths. See
[`docs/LIVE_STUDIONET_EVIDENCE.md`](docs/LIVE_STUDIONET_EVIDENCE.md) for
transaction links, finalized readback, source-byte commitments, and the clearly
separated historical failed revisions.
