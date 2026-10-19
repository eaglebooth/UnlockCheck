import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const explorer = "https://explorer-studio.genlayer.com";
export const contractAddress = import.meta.env.VITE_UNLOCKCHECK_ADDRESS || "";
export const chain = { ...studionet, blockExplorers: { default: { name: "GenLayer Studio Explorer", url: explorer } } };
const chainIdHex = `0x${chain.id.toString(16)}`;

type Provider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: Provider } }
type Client = {
  readContract: (input: { address: `0x${string}`; functionName: string; args: unknown[]; transactionHashVariant?: "latest-final" }) => Promise<unknown>;
  writeContract: (input: { address: `0x${string}`; functionName: string; args: unknown[]; value: bigint }) => Promise<string | { txId: string }>;
  waitForTransactionReceipt: (input: { hash: `0x${string}`; status: "FINALIZED"; interval: number; retries: number }) => Promise<{ statusName?: string; txExecutionResultName?: string; consensus_data?: { leader_receipt?: Array<{ mode?: string; execution_result?: string; genvm_result?: { error_code?: string | null } }>; validators?: Array<{ mode?: string; execution_result?: string; genvm_result?: { error_code?: string | null } }> } }>;
};

export type Receipt = {
  receipt_id: string; assessor: string; status: "MATCH" | "MISMATCH" | "AMBIGUOUS";
  effective_start: number; observed_start: number; chain_id: number; wallet: string; token: string;
  block_number: number; block_hash: string; code_hash: string; forum_url: string; snapshot_proposal_id: string;
  vesting_url: string; address_url: string; forum_sha256: string; snapshot_sha256: string; vesting_doc_sha256: string;
  address_doc_sha256: string; forum_bytes: number; snapshot_bytes: number; vesting_doc_bytes: number; address_doc_bytes: number; evidence_digest: string;
};
export class ReadbackPendingError extends Error {
  constructor(readonly hash: string, readonly requestId: string, readonly account: string) {
    super("Transaction finalized but its exact receipt readback is not available yet.");
    this.name = "ReadbackPendingError";
  }
}

const client = (provider?: Provider, account?: string) => createClient({
  chain,
  ...(provider && account ? { provider, account: account as `0x${string}` } : {}),
}) as unknown as Client;
const validAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);

export async function connectWallet(): Promise<string> {
  if (!window.ethereum) throw new Error("Install a wallet such as MetaMask to submit an assessment.");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts?.[0]) throw new Error("Wallet did not return an account.");
  const currentChain = String(await window.ethereum.request({ method: "eth_chainId" })).toLowerCase();
  if (currentChain !== chainIdHex.toLowerCase()) {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (reason) {
      const code = typeof reason === "object" && reason !== null && "code" in reason ? Number((reason as { code: unknown }).code) : 0;
      if (code !== 4902) throw new Error("Switch your wallet to GenLayer StudioNet (chain 61999).");
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
        chainId: chainIdHex,
        chainName: "GenLayer StudioNet",
        nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
        rpcUrls: ["https://studio.genlayer.com/api"],
        blockExplorerUrls: [explorer],
      }] });
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    }
    const afterSwitch = String(await window.ethereum.request({ method: "eth_chainId" })).toLowerCase();
    if (afterSwitch !== chainIdHex.toLowerCase()) throw new Error("Wallet did not switch to GenLayer StudioNet.");
  }
  return accounts[0];
}

export async function currentWallet(): Promise<string> {
  if (!window.ethereum) return "";
  const accounts = await window.ethereum.request({ method: "eth_accounts" }) as string[];
  return accounts?.[0] || "";
}

export async function getStats(): Promise<{ receipt_count: number }> {
  if (!validAddress(contractAddress)) throw new Error("Contract address is not configured yet.");
  return JSON.parse(String(await client().readContract({ address: contractAddress as `0x${string}`, functionName: "get_stats", args: [], transactionHashVariant: "latest-final" }))) as { receipt_count: number };
}

export async function getReceipt(id: number): Promise<Receipt> {
  if (!validAddress(contractAddress)) throw new Error("Contract address is not configured yet.");
  return JSON.parse(String(await client().readContract({ address: contractAddress as `0x${string}`, functionName: "get_receipt", args: [String(id)], transactionHashVariant: "latest-final" }))) as Receipt;
}

export async function getReceiptFor(account: string, requestId: string): Promise<Receipt> {
  if (!validAddress(contractAddress) || !validAddress(account)) throw new Error("Contract address is not configured yet.");
  return JSON.parse(String(await client().readContract({ address: contractAddress as `0x${string}`, functionName: "get_receipt_for", args: [account, requestId], transactionHashVariant: "latest-final" }))) as Receipt;
}

export async function submitAssessment(account: string, requestId: string): Promise<{ hash: string; receipt: Receipt }> {
  if (!validAddress(contractAddress) || !validAddress(account) || !window.ethereum) throw new Error("Connect a wallet and configure the deployed contract address.");
  const c = client(window.ethereum, account);
  const raw = await c.writeContract({ address: contractAddress as `0x${string}`, functionName: "assess", args: [requestId], value: 0n });
  const hash = typeof raw === "string" ? raw : raw.txId;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Wallet returned an invalid transaction hash.");
  const finalized = await c.waitForTransactionReceipt({ hash: hash as `0x${string}`, status: "FINALIZED", interval: 2500, retries: 360 });
  const receipts = [...(finalized.consensus_data?.leader_receipt || []), ...(finalized.consensus_data?.validators || [])];
  const leader = receipts.find((entry) => entry.mode === "leader");
  if (String(finalized.statusName).toUpperCase() !== "FINALIZED" || String(finalized.txExecutionResultName).toUpperCase().includes("ERROR") || !leader || leader.execution_result !== "SUCCESS" || leader.genvm_result?.error_code) {
    throw new Error("The transaction did not complete successfully. No success state is shown.");
  }
  // A transaction status alone is not UI success: read authoritative finalized state.
  let receipt: Receipt;
  try { receipt = await getReceiptFor(account, requestId); }
  catch { throw new ReadbackPendingError(hash, requestId, account); }
  if (receipt.assessor.toLowerCase() !== account.toLowerCase()) throw new Error("Finalized receipt readback did not match the submitting wallet.");
  return { hash, receipt };
}

export function watchWallet(callback: (account: string) => void): () => void {
  if (!window.ethereum?.on) return () => undefined;
  const listener = (accounts: unknown) => callback((accounts as string[] | undefined)?.[0] || "");
  window.ethereum.on("accountsChanged", listener);
  return () => window.ethereum?.removeListener?.("accountsChanged", listener);
}
