import { useCallback, useEffect, useState } from "react";
import { contractAddress, connectWallet, currentWallet, explorer, getReceipt, getReceiptFor, getStats, ReadbackPendingError, Receipt, submitAssessment, watchWallet } from "../lib/chain";

const short = (value: string, n = 7) => value ? `${value.slice(0, n)}…${value.slice(-5)}` : "Not set";
const date = (epoch: number) => epoch ? new Date(epoch * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "Not resolved";

export function App() {
  const [wallet, setWallet] = useState("");
  const [count, setCount] = useState(0);
  const [receiptId, setReceiptId] = useState(0);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tx, setTx] = useState("");
  const [pending, setPending] = useState<{ hash: string; requestId: string; account: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const stats = await getStats();
      setCount(stats.receipt_count);
      if (pending) {
        const exact = await getReceiptFor(pending.account, pending.requestId);
        setReceipt(exact); setReceiptId(Number(exact.receipt_id)); setTx(pending.hash); setPending(null);
        setMessage("Finalized receipt confirmed from exact request readback."); setError("");
        return;
      }
      if (stats.receipt_count > 0) {
        setReceiptId((old) => old || stats.receipt_count);
        const selected = receiptId || stats.receipt_count;
        if (selected <= stats.receipt_count) setReceipt(await getReceipt(selected));
      }
    } catch (reason) {
      if (pending) setMessage("The transaction is finalized, but exact receipt readback is still pending. Refresh; do not submit it again.");
      else if (contractAddress) setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [receiptId, pending]);

  useEffect(() => {
    void currentWallet().then(setWallet);
    void refresh();
    return watchWallet(setWallet);
  }, [refresh]);

  async function connect() {
    try { setError(""); setWallet(await connectWallet()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function assess() {
    if (pending) { await refresh(); return; }
    let account = wallet;
    if (!account) {
      try { account = await connectWallet(); setWallet(account); }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    }
    setBusy(true); setError(""); setMessage("Waiting for wallet signature…"); setTx("");
    try {
      const result = await submitAssessment(account, crypto.randomUUID());
      setTx(result.hash); setReceipt(result.receipt); setReceiptId(Number(result.receipt.receipt_id));
      setMessage("Finalized receipt confirmed from contract readback.");
      await refresh();
    } catch (reason) {
      if (reason instanceof ReadbackPendingError) {
        setPending({ hash: reason.hash, requestId: reason.requestId, account: reason.account });
        setTx(reason.hash); setError(""); setMessage("Transaction finalized; exact receipt readback is pending. Refresh before submitting again.");
      } else {
        setMessage(""); setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally { setBusy(false); }
  }

  async function selectReceipt(id: number) {
    setReceiptId(id); setError("");
    try { setReceipt(await getReceipt(id)); } catch (reason) { setReceipt(null); setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="UnlockCheck home"><img src="/unlockcheck-logo.png" alt="UnlockCheck logo"/><span><strong>unlockcheck</strong><small>ONCHAIN SOURCE RECEIPTS</small></span></a>
      <div className="top-actions"><span className="network"><i/>StudioNet</span><button className="wallet" onClick={connect}>{wallet ? short(wallet) : "Connect wallet"}</button></div>
    </header>

    <section className="hero" id="top">
      <div className="hero-copy"><p className="eyebrow">SOURCE-BOUND VESTING CHECK</p><h1>One Snapshot epoch.<br/><em>One pinned chain fact.</em></h1><p className="lede">A permissionless receipt comparing the fixed Arbitrum AIP-1.1 Snapshot approval epoch with the vesting wallet’s finalized onchain <code>start()</code> value.</p>
        <div className="hero-buttons"><button className="primary" disabled={busy || !contractAddress} onClick={assess}>{busy ? <><span className="spinner"/> Assessing…</> : pending ? "Refresh finalized receipt" : wallet ? "Run an assessment" : "Connect to assess"}<span aria-hidden>↗</span></button><a className="text-link" href="#method">How it works <span>↓</span></a></div>
        <p className="micro">No admin role · No token custody · Any wallet can assess</p>
      </div>
      <aside className="scope-card"><div className="scope-top"><span className="live-dot"/> FIXED SUBJECT <span className="scope-tag">ARB · 42161</span></div><div className="scope-row"><span>Vesting wallet</span><a href="https://arbiscan.io/address/0x15533b77981cDa0F85c4F9a485237DF4285D6844" target="_blank" rel="noreferrer">{short("0x15533b77981cDa0F85c4F9a485237DF4285D6844", 10)} ↗</a></div><div className="scope-row"><span>Claimed start</span><strong>{date(1681754400)}</strong></div><div className="scope-row"><span>Contract field</span><code>start()</code></div><div className="scope-bottom"><span>Registered receipts</span><strong>{count}</strong></div></aside>
      <div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/>
    </section>

    <div className="notice"><span className="notice-mark">i</span><p><strong>Bounded claim only.</strong> “MATCH” means this field equals the fixed AIP-1.1 Snapshot approval epoch at the recorded block. It does not certify the whole vesting schedule, legal effect, token safety, or future transfers.</p></div>
    {(error || message) && <div className={`feedback ${error ? "is-error" : ""}`} role="status">{error || message}{tx && <a href={`${explorer}/tx/${tx}`} target="_blank" rel="noreferrer"> View transaction ↗</a>}</div>}

    <section className="workspace">
      <div className="section-head"><div><p className="eyebrow">LATEST ONCHAIN RESULT</p><h2>Assessment receipt</h2></div><button className="quiet-button" onClick={() => void refresh()}>↻ Refresh</button></div>
      {receipt ? <div className="receipt-card">
        <div className="receipt-heading"><div><span className="receipt-label">RECEIPT #{receipt.receipt_id.padStart(4, "0")}</span><h3>{receipt.status === "MATCH" ? "Start parameter matches" : receipt.status === "MISMATCH" ? "Start parameter differs" : "Source interpretation is ambiguous"}</h3></div><span className={`verdict ${receipt.status.toLowerCase()}`}>{receipt.status}</span></div>
        <div className="comparison"><div className="compare-cell"><span>Source-claimed start</span><strong>{date(receipt.effective_start)}</strong><small>{receipt.effective_start || "No effective value resolved"}</small></div><div className="compare-symbol">≟</div><div className="compare-cell observed"><span>Onchain start()</span><strong>{date(receipt.observed_start)}</strong><small>Read at finalized block {receipt.block_number.toLocaleString()}</small></div></div>
        <div className="receipt-meta"><div><span>Checked by</span><code>{short(receipt.assessor, 9)}</code></div><div><span>Block hash</span><a href={`https://arbiscan.io/block/${receipt.block_number}`} target="_blank" rel="noreferrer">{short(receipt.block_hash, 10)} ↗</a></div><div><span>Code SHA-256</span><code>{short(receipt.code_hash, 10)}</code></div><div><span>Evidence digest</span><code>{short(receipt.evidence_digest, 10)}</code></div></div>
        <div className="source-hashes"><p>Fetched-source SHA-256 commitments · exact byte length</p><div><span>Forum <code>{short(receipt.forum_sha256, 10)}</code> <small>{receipt.forum_bytes.toLocaleString()} B</small></span><span>Snapshot <code>{short(receipt.snapshot_sha256, 10)}</code> <small>{receipt.snapshot_bytes.toLocaleString()} B</small></span><span>Vesting docs <code>{short(receipt.vesting_doc_sha256, 10)}</code> <small>{receipt.vesting_doc_bytes.toLocaleString()} B</small></span><span>Address index <code>{short(receipt.address_doc_sha256, 10)}</code> <small>{receipt.address_doc_bytes.toLocaleString()} B</small></span></div></div>
        <div className="receipt-links"><a href={receipt.forum_url} target="_blank" rel="noreferrer">AIP-1.1 Forum ↗</a><a href={`https://snapshot.org/#/arbitrumfoundation.eth/proposal/${receipt.snapshot_proposal_id}`} target="_blank" rel="noreferrer">Snapshot vote ↗</a><a href={receipt.vesting_url} target="_blank" rel="noreferrer">Vesting documentation ↗</a><a href={receipt.address_url} target="_blank" rel="noreferrer">Address registry ↗</a><a href={`https://arbiscan.io/address/${receipt.wallet}`} target="_blank" rel="noreferrer">Wallet on Arbiscan ↗</a></div>
      </div> : <div className="empty-state"><div className="empty-icon">◎</div><h3>{contractAddress ? "No assessment receipts yet" : "Contract address not configured"}</h3><p>{contractAddress ? "Connect any StudioNet wallet and submit the fixed-source assessment. Reviewers can use their own wallet." : "Set VITE_UNLOCKCHECK_ADDRESS after StudioNet deployment; the application will then read authoritative state."}</p></div>}
      {count > 1 && <div className="history"><span>RECENT RECEIPTS</span><div>{Array.from({ length: Math.min(count, 8) }, (_, index) => count - index).map((id) => <button className={id === receiptId ? "selected" : ""} key={id} onClick={() => void selectReceipt(id)}>#{String(id).padStart(4, "0")} <span>View receipt →</span></button>)}</div></div>}
    </section>

    <section className="method" id="method"><div className="method-title"><p className="eyebrow">THE VERIFICATION PATH</p><h2>Not a claim dashboard.<br/><em>A pinned fact check.</em></h2></div><div className="steps"><article><span>01</span><div><h3>Bind the approved vote</h3><p>The fixed Arbitrum Forum page and immutable Snapshot proposal ID identify AIP-1.1; exact response bytes get SHA-256 commitments.</p></div></article><article><span>02</span><div><h3>Confirm the approval epoch</h3><p>Validators independently query the closed Snapshot proposal and require its end epoch to equal the reviewed schedule start.</p></div></article><article><span>03</span><div><h3>Pin the chain fact</h3><p>Arbitrum One chain ID, finalized block hash, wallet code hash, and <code>start()</code> return value are read and cross-checked.</p></div></article><article><span>04</span><div><h3>Append, or leave no trace</h3><p>A confirmed match or mismatch becomes an immutable receipt. Retrieval or consensus failure reverts without blocking retry.</p></div></article></div></section>

    <footer><div className="footer-brand"><img src="/unlockcheck-logo.png" alt=""/><span>UnlockCheck <small>RECEIPTS, NOT GUARANTEES</small></span></div><div className="footer-links"><a href="https://docs.arbitrum.foundation/airdrop-eligibility-distribution" target="_blank" rel="noreferrer">Source documentation ↗</a><a href={explorer} target="_blank" rel="noreferrer">GenLayer Explorer ↗</a><a href="https://arbiscan.io" target="_blank" rel="noreferrer">Arbiscan ↗</a></div><small className="footer-note">StudioNet is for testing. This receipt is not legal, security, or investment advice.</small></footer>
  </main>;
}
