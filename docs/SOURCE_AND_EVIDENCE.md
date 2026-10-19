# Source and evidence boundary

## Fixed subject

- Network: Arbitrum One (`eth_chainId` 42161)
- Wallet: `0x15533b77981cDa0F85c4F9a485237DF4285D6844`
- Token: `0x912CE59144191C1204E64559FE8253a0e49E6548`
- Onchain field: zero-argument `start()` (`0xbe9a6555`)
- Source-claimed effective start: `1681754400` (2023-04-17 18:00 UTC)

The contract is deliberately not a general vesting auditor. It does not inspect
cliffs, duration, beneficiary, token amount, claim logic, upgradeability, balances,
legal status, or future execution. `MATCH` means only that the specific getter
equals the effective timestamp resolved from the sources for the selected
finalized block.

The two Arbitrum governance documentation pages are explicitly marked “PUBLIC
PREVIEW” by their publisher and may change. They are treated as current publisher
pages, not immutable policy text. Each successful assessment commits the exact
response byte lengths and SHA-256 hashes. A material edit that changes the
effective timestamp fails closed and requires a source/code review.

## Source authorities

1. [AIP-1.1 Arbitrum Forum record](https://forum.arbitrum.foundation/t/proposal-aip-1-1-lockup-budget-transparency/13360): connects AIP-1.1 to its Snapshot vote and identifies the corrected configuration.
2. [Snapshot proposal](https://snapshot.org/#/arbitrumfoundation.eth/proposal/0x7203289844e807781e8d2ec110d4b97a79a29944cae06a52dbe315a16381a2ae): queried by its fixed proposal ID through Snapshot Hub; its closed `end` epoch must equal `1681754400`.
3. [Arbitrum DAO token allocation and vesting documentation](https://docs.arbitrum.foundation/airdrop-eligibility-distribution): public description of the Foundation vesting allocation and four-year period.
4. [Official Arbitrum DAO deployment addresses](https://docs.arbitrum.foundation/deployment-addresses): wallet/token identity cross-check.

At assessment time the contract hashes the exact Forum, Snapshot API, vesting,
and address-registry response bytes. The leader and validators independently
fetch the same fixed sources. A receipt records those hashes, the finalized
block number/hash, wallet code SHA-256, observed getter result, and evidence
digest. No caller can substitute a URL, Snapshot proposal, RPC endpoint, chain,
or address.

## Current StudioNet deployment and positive evidence

- Contract: [`0xf95DB72FACA2B08732B391977dd2f13FaA58Ca8d`](https://explorer-studio.genlayer.com/address/0xf95DB72FACA2B08732B391977dd2f13FaA58Ca8d)
- Chain: GenLayer StudioNet (`61999`)
- Deployment transaction: not asserted; this is a pre-existing owner-designated contract.
- Deployed source and `contracts/unlock_check.py` match byte-for-byte: 18,897
  UTF-8 bytes, SHA-256 `6764e0c9476a44b04e002df8a374f35339d331a1389ecc92927b2c047bf8d01e`.
- Exact finalized readback moved `receipt_count` from 0 to 4.

## Live SDK assessment run (two independent wallets)

- Evidence file: [`live-evidence/studionet-f95-live-e2e.json`](live-evidence/studionet-f95-live-e2e.json)
- Wallet A (`dbl-owner`) transaction:
  [`0x296bf8c0febcde165b2d74b42c70426318a15e98aaaea70487b5838129a26aaa`](https://explorer-studio.genlayer.com/tx/0x296bf8c0febcde165b2d74b42c70426318a15e98aaaea70487b5838129a26aaa)
- Wallet B (`dbl-adapter`) transaction:
  [`0x6cd5486553ca7d10d7ad595a5cb812091bd5195210062f7e9e8f81f5c79cc30d`](https://explorer-studio.genlayer.com/tx/0x6cd5486553ca7d10d7ad595a5cb812091bd5195210062f7e9e8f81f5c79cc30d)
- Both finalized with `SUCCESS` and returned caller-scoped `MATCH` receipts.
  The receipts independently record Arbitrum block `516223544`, its block hash,
  the `start()` result, response byte hashes/lengths, and evidence digest.

## Evidence tiers

- **Synthetic classification examples:** `fixtures/semantic_cases.json`; illustrative only, not source-backed/live evidence.
- **Direct Mode tests:** execute the public contract entrypoint and verify retryable failure does not mutate state; mocks are test infrastructure and are not counted as real-source evidence.
- **Live StudioNet evidence:** two signed, finalized successful assessments are
  recorded above; their receipt data is the positive source/RPC evidence.
- **Historical diagnostic runs:** older JSON files in `live-evidence/` document
  failed source configurations. They remain traceable but are not positive proof.

Source URLs are remote and may change. If the effective start value changes, the
contract intentionally fails closed with `SOURCE_EFFECTIVE_START_CHANGED`; the
source manifest and contract must be reviewed and redeployed before making a new
claim.
