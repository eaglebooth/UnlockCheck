import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient, createAccount } from '../frontend/node_modules/genlayer-js/dist/index.js';
import { studionet } from '../frontend/node_modules/genlayer-js/dist/chains/index.js';

const CONTRACT = '0xf95DB72FACA2B08732B391977dd2f13FaA58Ca8d';
const EXPECTED_A = '0xeb57bc7125fa60d7482ce12058397369ab3581f8';
const EXPECTED_B = '0x2da5393d7bbb9a037dc3abb56dbbc5c150fc843f';
const cliRequire = createRequire(process.env.GENLAYER_CLI_ENTRY || 'C:/Users/admin/AppData/Roaming/npm/node_modules/genlayer/dist/index.js');
const keytar = cliRequire('keytar');

const keyA = await keytar.getPassword('genlayer-cli', 'account:dbl-owner');
const keyB = await keytar.getPassword('genlayer-cli', 'account:dbl-adapter');
if (!keyA || !keyB) throw new Error('Unlock dbl-owner and dbl-adapter with GenLayer CLI first; keys are never requested in chat.');
const accountA = createAccount(keyA.startsWith('0x') ? keyA : `0x${keyA}`);
const accountB = createAccount(keyB.startsWith('0x') ? keyB : `0x${keyB}`);
if (accountA.address.toLowerCase() !== EXPECTED_A || accountB.address.toLowerCase() !== EXPECTED_B) {
  throw new Error('Test signer identity mismatch; no transaction was submitted.');
}

const clientA = createClient({ chain: studionet, account: accountA });
const clientB = createClient({ chain: studionet, account: accountB });
const source = readFileSync('contracts/unlock_check.py');
const deployedSource = Buffer.from(await clientA.getContractCode(CONTRACT), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
if (!source.equals(deployedSource)) throw new Error('Deployed source differs from local source; no transaction was submitted.');

const run = process.argv[2] || new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
if (!/^[a-zA-Z0-9_-]{1,35}$/.test(run)) throw new Error('Invalid run id.');
const evidenceDir = 'docs/live-evidence';
mkdirSync(evidenceDir, { recursive: true });
const evidencePath = `${evidenceDir}/studionet-${run}.json`;
const report = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : {
  project: 'UnlockCheck',
  run,
  network: 'GenLayer StudioNet',
  chain_id: 61999,
  contract: CONTRACT,
  source_parity: {
    byte_for_byte: true,
    byte_length: source.length,
    local_sha256: sha256(source),
    deployed_sha256: sha256(deployedSource),
  },
  signing_method: 'GenLayerJS SDK; signer private keys read in memory from GenLayer CLI OS keychain; never persisted.',
  scope: 'Two-wallet SDK E2E: happy path, invalid-input failure, duplicate-request conflict, and cross-sender adversarial isolation with exact finalized readback.',
  actors: { A: accountA.address, B: accountB.address },
  steps: [],
  assertions: [],
  started_at: new Date().toISOString(),
};
report.assertions = report.assertions.filter((assertion) => assertion.name !== 'wallet-a finalized successful execution' && !assertion.name.startsWith('conflict-replay-wallet-a '));
report.assertions = [...new Map(report.assertions.map((assertion) => [assertion.name, assertion])).values()];
report.scope ||= 'Two-wallet SDK E2E: happy path, invalid-input failure, duplicate-request conflict, and cross-sender adversarial isolation with exact finalized readback.';
delete report.error;
const save = () => writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const check = (pass, name, details = {}) => {
  const assertion = { name, pass: Boolean(pass), details, at: new Date().toISOString() };
  const existing = report.assertions.findIndex((item) => item.name === name);
  if (existing >= 0) report.assertions[existing] = assertion;
  else report.assertions.push(assertion);
  save();
  if (!pass) throw new Error(`Assertion failed: ${name}`);
};
const read = async (client, method, args = []) => client.readContract({
  address: CONTRACT,
  functionName: method,
  args,
  transactionHashVariant: 'latest-final',
});
const asJson = (value) => JSON.parse(String(value));
const all = (value) => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const execution = (tx) => {
  const leader = all(tx.consensus_data?.leader_receipt).find((r) => r?.mode === 'leader') || all(tx.consensus_data?.leader_receipt)[0];
  if (leader?.genvm_result?.error_code) return 'ERROR';
  if (leader?.execution_result) return String(leader.execution_result).toUpperCase();
  return String(tx.txExecutionResultName || 'UNKNOWN').toUpperCase();
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCommittedReceipt(client, assessor, requestId, previousCount) {
  let lastStats = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    try {
      const stats = asJson(await read(client, 'get_stats'));
      lastStats = stats;
      if (stats.receipt_count === previousCount + 1) {
        const receipt = asJson(await read(client, 'get_receipt_for', [assessor, requestId]));
        return { stats, receipt, attempt };
      }
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await delay(2500);
  }
  throw new Error(`Committed receipt was not readable after 45 seconds: count=${lastStats?.receipt_count ?? 'unavailable'} prior=${previousCount}; ${lastError || 'no read error'}`);
}

try {
  // A resumed process must preserve the pre-run baseline; otherwise a finalized
  // first transaction would be counted again after a CLI/tool timeout.
  const initialStats = report.initial_stats || asJson(await read(clientA, 'get_stats'));
  report.initial_stats = initialStats;
  check(Number.isInteger(initialStats.receipt_count), 'initial finalized stats readable', initialStats);

  const happyA = `unlockcheck-${run}-happy-a`.toLowerCase();
  const sharedAudit = `unlockcheck-${run}-audit-shared`.toLowerCase();
  const scenarios = [
    { label: 'happy-wallet-a', account: accountA, client: clientA, requestId: happyA, expectation: 'success', purpose: 'happy path from auxiliary wallet A' },
    { label: 'conflict-replay-wallet-a', account: accountA, client: clientA, requestId: happyA, expectation: 'failure', reusesExisting: true, purpose: 'replay of A request must not append or overwrite its original receipt' },
    { label: 'failure-invalid-wallet-b', account: accountB, client: clientB, requestId: 'bad', expectation: 'failure', purpose: 'invalid request ID must fail without mutation' },
    { label: 'happy-wallet-b', account: accountB, client: clientB, requestId: `unlockcheck-${run}-happy-b`.toLowerCase(), expectation: 'success', purpose: 'independent happy path from auxiliary wallet B' },
    { label: 'audit-shared-wallet-a', account: accountA, client: clientA, requestId: sharedAudit, expectation: 'success', purpose: 'adversarial baseline: A owns its shared-looking request ID' },
    { label: 'audit-shared-wallet-b', account: accountB, client: clientB, requestId: sharedAudit, expectation: 'success', purpose: 'adversarial isolation: B can use same request ID without blocking or overwriting A' },
  ];

  for (const { label, account, client, requestId, expectation, purpose, reusesExisting = false } of scenarios) {
    let step = report.steps.find((item) => item.label === label);
    if (step?.tx_hash) {
      if (step.signer.toLowerCase() !== account.address.toLowerCase() || step.request_id !== requestId) throw new Error(`${label}: existing evidence identity mismatch`);
      console.log(`${label} resuming existing transaction ${step.tx_hash}; will not resubmit`);
    } else {
      const before = asJson(await read(clientA, 'get_stats'));
      step = { label, purpose, expectation, signer: account.address, request_id: requestId, method: 'assess', before, submitted_at: new Date().toISOString() };
      report.steps.push(step);
      save();
      const raw = await client.writeContract({ address: CONTRACT, functionName: 'assess', args: [requestId], value: 0n });
      step.tx_hash = typeof raw === 'string' ? raw : raw?.txId;
      save();
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(step.tx_hash || '')) throw new Error(`${label}: SDK did not return a transaction hash`);
    console.log(`${label} transaction ${step.tx_hash}`);

    let tx;
    for (let attempt = 0; attempt < 480; attempt += 1) {
      try {
        tx = await client.getTransaction({ hash: step.tx_hash });
        step.status = tx.statusName || 'UNKNOWN';
        step.execution = execution(tx);
        if (['FINALIZED', 'CANCELED', 'LEADER_TIMEOUT', 'VALIDATORS_TIMEOUT'].includes(step.status)) break;
      } catch (error) {
        step.last_read_error = String(error).slice(0, 300);
      }
      if (attempt % 12 === 0) {
        save();
        console.log(`${label} waiting: ${step.status || 'UNKNOWN'} (${attempt})`);
      }
      await delay(2500);
    }

    if (!tx) throw new Error(`${label}: transaction status unavailable; inspect hash before any retry`);
    step.status = tx.statusName || 'UNKNOWN';
    step.execution = execution(tx);
    step.consensus_result = tx.consensus_data?.result_name || tx.consensus_data?.consensus_result || null;
    step.leader_receipts = all(tx.consensus_data?.leader_receipt);
    step.validator_receipts = all(tx.consensus_data?.validators);
    step.tx_execution_result_name = tx.txExecutionResultName || null;
    if (expectation === 'success') {
      check(step.status === 'FINALIZED' && step.execution === 'SUCCESS', `${label} finalized successful execution`, { hash: step.tx_hash, status: step.status, execution: step.execution });
      const committed = await waitForCommittedReceipt(clientA, account.address.toLowerCase(), requestId, step.before.receipt_count);
      const after = committed.stats;
      const receipt = committed.receipt;
      step.after = after;
      step.readback_attempt = committed.attempt;
      step.receipt = receipt;
      check(receipt.assessor.toLowerCase() === account.address.toLowerCase(), `${label} exact assessor readback`, { assessor: receipt.assessor });
      check(['MATCH', 'MISMATCH', 'AMBIGUOUS'].includes(receipt.status), `${label} bounded receipt status`, { status: receipt.status });
      check(after.receipt_count === step.before.receipt_count + 1, `${label} exactly one receipt appended`, { before: step.before.receipt_count, after: after.receipt_count });
    } else {
      const after = asJson(await read(clientA, 'get_stats'));
      step.after = after;
      step.failure_reason = 'EXPECTED_REVERT_NO_MUTATION';
      check(step.status === 'FINALIZED' && step.execution === 'ERROR', `${label} expected failure finalized without successful execution`, {
        hash: step.tx_hash, status: step.status, execution: step.execution,
      });
      check(after.receipt_count === step.before.receipt_count, `${label} failed assessment leaves count unchanged`, {
        before: step.before.receipt_count, after: after.receipt_count,
      });
      let receiptAbsent = false;
      let existingReceipt = null;
      try {
        const unexpected = asJson(await read(clientA, 'get_receipt_for', [account.address.toLowerCase(), requestId]));
        step.unexpected_receipt = unexpected;
        existingReceipt = unexpected;
      } catch {
        receiptAbsent = true;
        step.receipt_absent = true;
      }
      if (reusesExisting) {
        step.existing_receipt = existingReceipt;
        check(!receiptAbsent && existingReceipt?.assessor?.toLowerCase() === account.address.toLowerCase(), `${label} original receipt remains readable after replay`, { receipt_id: existingReceipt?.receipt_id || null });
      } else {
        check(receiptAbsent, `${label} failed assessment has no receipt`, { unexpected: step.unexpected_receipt || null });
      }
    }
    step.completed_at = new Date().toISOString();
    save();
    console.log(`${label} finalized ${step.execution}; receipt=${step.receipt?.receipt_id || 'none'} status=${step.receipt?.status || 'none'}`);
  }

  const finalStats = asJson(await read(clientA, 'get_stats'));
  report.final_stats = finalStats;
  report.completed_at = new Date().toISOString();
  const successful = report.steps.filter((step) => step.status === 'FINALIZED' && step.execution === 'SUCCESS').length;
  check(finalStats.receipt_count === initialStats.receipt_count + successful, 'final receipt count matches successful assessment transactions', {
    initial: initialStats.receipt_count, final: finalStats.receipt_count,
    successful_assessments: successful,
  });
  report.verification_complete = true;
  report.all_assertions_pass = report.assertions.every((assertion) => assertion.pass);
  report.successful_assessments = successful;
  report.outcome = successful === 4 ? 'happy_failure_conflict_and_adversarial_isolation_verified' : 'live_e2e_incomplete';
  save();
  console.log(`Evidence saved to ${evidencePath}; verification_complete=${report.verification_complete}; successful_assessments=${successful}`);
  if (!report.all_assertions_pass) process.exitCode = 1;
} catch (error) {
  report.error = String(error);
  report.completed_at = new Date().toISOString();
  save();
  console.error(`Live E2E stopped: ${String(error)}`);
  console.error(`Partial evidence saved to ${evidencePath}`);
  process.exitCode = 1;
}
