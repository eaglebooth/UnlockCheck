# Test plan

## Actual contract entrypoint

`tests/test_unlock_check.py` uses GenLayer Direct Mode against
`contracts/unlock_check.py`:

- deployment/schema initializes with no privileged assessor role;
- each write uses `(assessor, request_id)`, so a duplicate is rejected only for
  that sender/request and the frontend reads its exact receipt rather than a
  globally latest receipt that could race another user;
- an unavailable official source makes `assess()` revert with a retryable error;
- the failed attempt leaves `receipt_count` unchanged;
- a separate wallet can retry the same public action and is not blocked by a
  stale open record;
- no receipt can be read/claimed before a successful assessment.

The offline failure fixture is intentionally not presented as a successful
semantic assessment. It tests the safety/recovery property, not live source truth.

Direct Mode executes the leader path and exposes captured validators for explicit
`run_validator()` checks; it is not a substitute for Studio/GenVM consensus. A
manually rejected validator result in Direct Mode does not simulate chain
consensus rollback. That invariant still needs a consensus-level integration test
before claiming live no-mutation on disagreement.

## Required before submission as live evidence

1. Run the direct suite and record its output.
2. Deploy the revised contract, then run a Studio/GenVM integration assessment
   against the fixed Arbitrum Forum record, Snapshot proposal, and RPC; record
   each transaction ID and finalized receipt.
3. Run at least one permissionless assessment from each of the two test wallets.
   The contract has no deployer-only role and no per-study lock, so a third wallet
   (including a reviewer) can also run the same assessment.
4. Verify transaction status, successful leader execution, final contract
   `receipt_count`, and exact `get_receipt_for(assessor, request_id)` readback
   after finalization.
5. Verify the stored receipt's source digests, chain ID, block hash, code hash,
   start value, and evidence digest. Link transactions to the GenLayer explorer.
6. Report Arbitrum evidence separately from StudioNet transaction evidence.

If source retrieval fails or validators disagree, the write must not append a
receipt; retry from any wallet after diagnosing the external failure.
