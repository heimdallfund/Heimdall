import {
  type Address, type Hex, type PublicClient,
  getAddress, keccak256, encodePacked, parseAbi, toHex,
} from "viem";
import { knownContract, NATIVE_ASSET } from "./chains.js";
import { approvalsFromCall, decodeCall, expandBatch } from "./decode.js";
import { isBlocklisted } from "./blocklist.js";
import { inList, lc, type Policy, PolicySchema } from "./policy.js";
import { signReceipt } from "./receipt.js";
import { prelaunch } from "./signer.js";
import { probeTransferability, simulate, type SimResult } from "./simulate.js";
import { fmt, tokenMeta } from "./tokens.js";
import type { ApprovalInfo, AssetChange, CheckResult, Finding, TxIntent, Verdict } from "./types.js";

const BALANCE_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export interface ShieldDeps {
  client: PublicClient;
  sign?: boolean;
  now?: () => number;
}

function label(chainId: number, a: string | null | undefined) {
  if (!a) return "new contract";
  const k = knownContract(chainId, a);
  return k ? `${k.name} (${short(a)})` : short(a);
}

/** Deployed contracts stay contracts, so a positive answer is cached across checks (1 h, 5,000 entries).
 *  Wallets are never cached: they can be deployed to or (EIP-7702) delegated at any time. */
const CONTRACT_TTL_MS = 3_600_000;
const contractCaches = new WeakMap<PublicClient, Map<string, number>>();
async function isContract(client: PublicClient, a: Address): Promise<{ contract: boolean; delegated: boolean }> {
  let knownContracts = contractCaches.get(client);
  if (!knownContracts) contractCaches.set(client, (knownContracts = new Map()));
  const key = a.toLowerCase();
  const seen = knownContracts.get(key);
  if (seen && Date.now() - seen < CONTRACT_TTL_MS) return { contract: true, delegated: false };
  const code = await client.getCode({ address: a }).catch(() => undefined);
  if (!code || code === "0x") return { contract: false, delegated: false };
  const delegated = code.toLowerCase().startsWith("0xef0100");
  if (!delegated) {
    if (knownContracts.size >= 5_000) knownContracts.delete(knownContracts.keys().next().value!);
    knownContracts.set(key, Date.now());
  }
  return { contract: true, delegated };
}

function mergeApprovals(fromCall: ApprovalInfo[], sim: SimResult, agent: Address): ApprovalInfo[] {
  const out = [...fromCall];
  for (const a of sim.approvals) {
    if (lc(a.owner) !== lc(agent)) continue;
    const dup = out.some((x) => lc(x.token) === lc(a.token) && lc(x.spender) === lc(a.spender));
    if (dup) continue;
    if (a.kind === "erc20") {
      const amount = a.amount ?? 0n;
      out.push({ standard: "erc20", token: a.token, spender: a.spender, amount, unlimited: amount >= 1n << 128n, revoke: amount === 0n });
    } else {
      out.push({ standard: "erc721-all", token: a.token, spender: a.spender, unlimited: !!a.approved, revoke: !a.approved });
    }
  }
  return out;
}

async function assetChanges(client: PublicClient, tx: TxIntent, sim: SimResult): Promise<AssetChange[]> {
  const me = lc(tx.from);
  const map = new Map<string, AssetChange>();
  const touch = async (asset: Address, kind: AssetChange["kind"]) => {
    const k = lc(asset);
    let c = map.get(k);
    if (!c) {
      const meta = kind === "native" ? { symbol: "ETH", decimals: 18 } : await tokenMeta(client, tx.chainId, asset);
      c = { asset, symbol: meta.symbol, decimals: kind === "erc721" ? 0 : meta.decimals, kind, delta: 0n, counterparties: [] };
      map.set(k, c);
    }
    return c;
  };
  for (const t of sim.transfers) {
    const out = lc(t.from) === me, inn = lc(t.to) === me;
    if (out === inn) continue; // unrelated or self-transfer
    const c = await touch(t.asset, t.kind);
    const other = out ? t.to : t.from;
    if (!c.counterparties.some((x) => lc(x) === lc(other))) c.counterparties.push(other);
    if (t.kind === "erc721") {
      c.delta += out ? -1n : 1n;
      (c.tokenIds ??= []).push(t.amount);
    } else c.delta += out ? -t.amount : t.amount;
  }
  // If the simulator could not run, still account for the ETH value attached to the tx.
  if (!sim.available && tx.value > 0n) {
    const c = await touch(NATIVE_ASSET, "native");
    c.delta -= tx.value;
    if (tx.to) c.counterparties.push(tx.to);
  }
  return [...map.values()].filter((c) => c.delta !== 0n);
}

function verdictOf(findings: Finding[], policy: Policy): Verdict {
  if (findings.some((f) => f.severity === "deny")) return "DENY";
  if (findings.some((f) => f.severity === "warn")) return policy.strict ? "DENY" : "WARN";
  return "ALLOW";
}

function riskScore(findings: Finding[]): number {
  const deny = findings.filter((f) => f.severity === "deny").length;
  const warn = findings.filter((f) => f.severity === "warn").length;
  if (deny) return Math.min(100, 85 + deny * 5 + warn * 2);
  return Math.min(80, warn * 25);
}

export async function checkTransaction(rawTx: TxIntent, rawPolicy: unknown, deps: ShieldDeps): Promise<CheckResult> {
  const policy = PolicySchema.parse(rawPolicy ?? {});
  const { client } = deps;
  const tx: TxIntent = {
    ...rawTx,
    from: getAddress(rawTx.from),
    to: rawTx.to ? getAddress(rawTx.to) : null,
    data: (rawTx.data || "0x") as Hex,
  };
  const F: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string) => F.push({ code, severity, message });

  // 1. Target checks
  if (!tx.to) {
    add("CONTRACT_DEPLOY", policy.allowContractDeploy ? "info" : "warn", "Transaction deploys a new contract.");
  } else {
    if (tx.to === "0x0000000000000000000000000000000000000000") add("ZERO_TARGET", "deny", "Target is the zero address — funds would be burned.");
    if (inList(policy.denyTargets, tx.to)) add("DENYLISTED_TARGET", "deny", `Target ${short(tx.to)} is on the deny list.`);
    if (isBlocklisted(tx.to)) add("BLOCKLISTED_TARGET", "deny", `Target ${short(tx.to)} is on the Heimdall blocklist of known drainers and exploits.`);
    if (policy.allowTargets && !inList(policy.allowTargets, tx.to))
      add("TARGET_NOT_ALLOWED", "deny", `Target ${short(tx.to)} is not in the agent's allow list.`);
  }

  // 2. Decode + parallel lookups. Code lookups are memoised per check, and spenders that are known from the
  //    calldata alone are fetched alongside the simulation instead of after it (one RPC round trip saved).
  const decoded = decodeCall(tx.data);
  const codeCache = new Map<string, Promise<{ contract: boolean; delegated: boolean }>>();
  const codeOf = (a: Address) => {
    const k = lc(a);
    if (!codeCache.has(k)) codeCache.set(k, isContract(client, a));
    return codeCache.get(k)!;
  };
  const batch = expandBatch(tx.to, tx.data);
  const staticApprovals = [...approvalsFromCall(tx.to, decoded), ...batch.approvals];
  for (const a of staticApprovals) if (!a.revoke && !isBlocklisted(a.spender)) void codeOf(a.spender);
  const [target, sim] = await Promise.all([
    tx.to ? codeOf(tx.to) : Promise.resolve({ contract: false, delegated: false }),
    simulate(client, tx),
  ]);

  if (tx.to && tx.data !== "0x" && !target.contract)
    add("EOA_WITH_DATA", "warn", `Calldata is sent to ${short(tx.to)}, which is not a contract.`);
  if (target.delegated) add("DELEGATED_EOA", "info", "Target is an EIP-7702 delegated account.");
  if (tx.to && knownContract(tx.chainId, tx.to)) add("KNOWN_CONTRACT", "info", `Target is ${label(tx.chainId, tx.to)}.`);

  // 3. Approvals
  const approvals = mergeApprovals(staticApprovals, sim, tx.from);
  for (const a of approvals) if (!a.revoke && !isBlocklisted(a.spender)) void codeOf(a.spender);
  for (const a of approvals) {
    const what = `${a.standard === "erc721-all" ? "all NFTs of" : a.unlimited ? "UNLIMITED" : "limited"} ${label(tx.chainId, a.token)} to ${short(a.spender)}`;
    if (a.revoke) { add("APPROVAL_REVOKE", "info", `Revokes approval of ${label(tx.chainId, a.token)} for ${short(a.spender)}.`); continue; }
    if (isBlocklisted(a.spender)) { add("BLOCKLISTED_SPENDER", "deny", `Grants ${what} to a blocklisted address.`); continue; }
    const spender = await codeOf(a.spender);
    const trusted = inList(policy.trustedSpenders, a.spender);
    if (!spender.contract && !trusted) {
      if (tx.to && !target.contract) add("APPROVE_ON_EOA", "deny", "Approval call sent to a non-contract address.");
      add(a.unlimited ? "UNLIMITED_APPROVAL_TO_EOA" : "APPROVAL_TO_EOA", a.unlimited ? "deny" : "warn",
        `Grants ${what} — the spender is a plain wallet, a classic drainer pattern.`);
      continue;
    }
    if (a.unlimited) {
      if (policy.denyUnlimitedApprovals) add("UNLIMITED_APPROVAL", "deny", `Grants ${what}; policy forbids unlimited approvals.`);
      else if (trusted) add("UNLIMITED_APPROVAL_TRUSTED", "info", `Grants ${what} (trusted spender).`);
      else add("UNLIMITED_APPROVAL", "warn", `Grants ${what}. Prefer an exact amount.`);
    } else add("APPROVAL", "info", `Grants ${what}.`);
  }

  // 4. Simulation
  if (!sim.available) add("SIM_UNAVAILABLE", "warn", `Simulation unavailable${sim.error ? `: ${sim.error}` : ""}.`);
  else if (!sim.ok) add("SIM_REVERTED", "deny", `Transaction would revert: ${sim.revertReason}.`);

  // 5. Asset changes + spend limits
  const changes = await assetChanges(client, tx, sim);
  const outflows = changes.filter((c) => c.delta < 0n);
  const inflows = changes.filter((c) => c.delta > 0n);
  for (const c of outflows) {
    const out = -c.delta;
    if (c.kind === "native" && policy.maxNativeOut && out > BigInt(policy.maxNativeOut))
      add("NATIVE_LIMIT", "deny", `Sends ${fmt(out, 18)} ETH, above the ${fmt(BigInt(policy.maxNativeOut), 18)} ETH limit.`);
    const lim = Object.entries(policy.maxTokenOut).find(([k]) => lc(k) === lc(c.asset))?.[1];
    if (c.kind === "erc20" && lim && out > BigInt(lim))
      add("TOKEN_LIMIT", "deny", `Sends ${fmt(out, c.decimals)} ${c.symbol}, above the ${fmt(BigInt(lim), c.decimals)} limit.`);
    // Drains (almost) the whole balance?
    if (c.kind !== "erc721") {
      const bal = c.kind === "native"
        ? await client.getBalance({ address: tx.from }).catch(() => undefined)
        : await client.readContract({ address: c.asset, abi: BALANCE_ABI, functionName: "balanceOf", args: [tx.from] }).catch(() => undefined);
      if (bal && bal > 0n && out * 100n >= bal * 90n)
        add("DRAINS_BALANCE", "warn", `Moves ≥90% of the wallet's ${c.symbol} balance in one transaction.`);
    }
  }
  if (outflows.length && !inflows.length) {
    const untrusted = outflows.flatMap((c) => c.counterparties).filter((a) => !inList(policy.trustedRecipients, a));
    if (untrusted.length)
      add("ONE_WAY_OUTFLOW", "warn", `Assets leave the wallet to ${[...new Set(untrusted.map(short))].join(", ")} and nothing comes back.`);
  }
  for (const c of inflows) {
    if (c.kind === "erc20" && !knownContract(tx.chainId, c.asset) && c.symbol === "UNKNOWN")
      add("UNKNOWN_TOKEN_IN", "info", `Receives an unidentified token ${short(c.asset)}.`);
  }

  for (const c of outflows) {
    for (const cp of c.counterparties) if (isBlocklisted(cp)) add("BLOCKLISTED_RECIPIENT", "deny", `Sends ${c.symbol} to ${short(cp)}, a blocklisted address.`);
  }

  // 5b. Can the agent move what it receives? (honeypots, transfer taxes)
  const unknownIn = inflows.filter((c) => c.kind === "erc20" && !knownContract(tx.chainId, c.asset));
  if (sim.ok && unknownIn.length) {
    const probes = await probeTransferability(client, tx, unknownIn.map((c) => ({ token: c.asset, amount: c.delta })));
    for (const p of probes) {
      const sym = unknownIn.find((c) => c.asset.toLowerCase() === p.token.toLowerCase())?.symbol ?? short(p.token);
      if (!p.ok) { add("HONEYPOT", "deny", `The ${sym} you receive cannot be moved again (${p.reason}). Likely a honeypot.`); continue; }
      if (p.sent > 0n && p.received < p.sent) {
        const taxBps = Number(((p.sent - p.received) * 10_000n) / p.sent);
        const pct = (taxBps / 100).toFixed(1);
        if (taxBps >= 5_000) add("TRANSFER_TAX", "deny", `${sym} takes a ${pct}% tax on every transfer.`);
        else if (taxBps >= 500) add("TRANSFER_TAX", "warn", `${sym} takes a ${pct}% tax on every transfer.`);
        else add("TRANSFER_TAX", "info", `${sym} takes a ${pct}% tax on transfers.`);
      }
    }
  }

  // 6. Verdict
  const verdict = verdictOf(F, policy);
  const summary: string[] = [];
  summary.push(decoded ? `Calls ${decoded.signature} on ${label(tx.chainId, tx.to)}` : tx.data === "0x" ? `Plain transfer to ${label(tx.chainId, tx.to)}` : `Calls unknown function ${tx.data.slice(0, 10)} on ${label(tx.chainId, tx.to)}`);
  summary.push(...batch.lines);
  for (const t of batch.transfers) summary.push(`Router transfers ${t.amount} of ${label(tx.chainId, t.token)} → ${short(t.to)}`);
  for (const c of changes) {
    const amt = c.kind === "erc721" ? `${c.delta < 0n ? -c.delta : c.delta} NFT` : fmt(c.delta, c.decimals);
    summary.push(`${c.delta < 0n ? "Sends" : "Receives"} ${amt} ${c.symbol}`);
  }
  for (const a of approvals.filter((x) => !x.revoke)) summary.push(`Approves ${a.unlimited ? "unlimited" : "limited"} ${label(tx.chainId, a.token)} → ${short(a.spender)}`);

  const now = deps.now?.() ?? Date.now();
  const checkId = keccak256(encodePacked(["address", "address", "bytes32", "uint256", "uint256"],
    [tx.from, tx.to ?? "0x0000000000000000000000000000000000000000", keccak256(tx.data), tx.value, BigInt(now)]));

  const result: CheckResult = {
    checkId,
    verdict,
    riskScore: riskScore(F),
    summary,
    findings: F,
    decoded: decoded ? { functionName: decoded.functionName, signature: decoded.signature, args: [...decoded.args] } : undefined,
    approvals,
    assetChanges: changes,
    simulation: { ok: sim.ok, available: sim.available, gasUsed: sim.gasUsed, revertReason: sim.revertReason },
  };
  if (deps.sign !== false && !prelaunch()) result.receipt = await signReceipt(tx, verdict, checkId);
  return result;
}

/** JSON-safe serialization (bigint → string). */
export function toJSON(x: unknown): unknown {
  return JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export { toHex };
