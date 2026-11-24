import {
  type Address, type Hex, type PublicClient,
  getAddress, keccak256, encodePacked, parseAbi, toHex,
} from "viem";
import { KNOWN_CONTRACTS, knownContract, NATIVE_ASSET } from "./chains.js";
import { approvalsFromCall, decodeCall, expandBatch } from "./decode.js";
import { isBlocklisted } from "./blocklist.js";
import { inList, lc, type Policy, PolicySchema } from "./policy.js";
import { signReceipt } from "./receipt.js";
import { prelaunch } from "./signer.js";
import { probeReceivedToken, probeTransferability, simulate, STRANGER, type SimResult } from "./simulate.js";
import { fmt, tokenMeta } from "./tokens.js";
import { fakeTokenCheck } from "./impersonation.js";
import { lookalikeOf } from "./poison.js";
import { judgeAuthorization } from "./delegation.js";
import { TOKENS, KNOWN_SPENDERS } from "./registry.js";
import type { ApprovalInfo, AssetChange, CheckResult, Finding, TxIntent, Verdict } from "./types.js";

const BALANCE_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export interface ShieldDeps {
  client: PublicClient;
  sign?: boolean;
  now?: () => number;
  /** Addresses this wallet has already sent to or approved through Shield (for look-alike detection). */
  history?: string[];
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

/** Tokens the agent receives and loses again within the same transaction, to someone other than itself. */
function vanishing(sim: SimResult, agent: Address): { token: Address }[] {
  const me = lc(agent);
  const byToken = new Map<string, { token: Address; inn: bigint; out: bigint }>();
  for (const t of sim.transfers) {
    if (t.kind !== "erc20") continue;
    const k = lc(t.asset);
    const e = byToken.get(k) ?? { token: t.asset, inn: 0n, out: 0n };
    if (lc(t.to) === me && lc(t.from) !== me) e.inn += t.amount;
    if (lc(t.from) === me && lc(t.to) !== me) e.out += t.amount;
    byToken.set(k, e);
  }
  // received first, then (almost) all of it removed again
  const firstIn = (k: string) => sim.transfers.findIndex((t) => lc(t.asset) === k && lc(t.to) === me);
  const lastOut = (k: string) => { let i = -1; sim.transfers.forEach((t, j) => { if (lc(t.asset) === k && lc(t.from) === me) i = j; }); return i; };
  return [...byToken.entries()].filter(([k, e]) => e.inn > 0n && e.out * 100n >= e.inn * 90n && firstIn(k) < lastOut(k)).map(([, e]) => ({ token: e.token }));
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

  // 1b. EIP-7702: authorizations in a type 4 transaction hand the signing wallet's control to a contract.
  const authLines: string[] = [];
  for (const a of (rawTx.authorizationList ?? []).slice(0, 8)) {
    const j = await judgeAuthorization(a, tx.chainId, policy, client);
    F.push(...j.findings);
    authLines.push(j.summary);
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
  const balances = await Promise.all(outflows.map((c) => c.kind === "erc721" ? Promise.resolve(undefined)
    : c.kind === "native" ? client.getBalance({ address: tx.from }).catch(() => undefined)
    : client.readContract({ address: c.asset, abi: BALANCE_ABI, functionName: "balanceOf", args: [tx.from] }).catch(() => undefined)));
  for (const [i, c] of outflows.entries()) {
    const out = -c.delta;
    if (c.kind === "native" && policy.maxNativeOut && out > BigInt(policy.maxNativeOut))
      add("NATIVE_LIMIT", "deny", `Sends ${fmt(out, 18)} ETH, above the ${fmt(BigInt(policy.maxNativeOut), 18)} ETH limit.`);
    const lim = Object.entries(policy.maxTokenOut).find(([k]) => lc(k) === lc(c.asset))?.[1];
    if (c.kind === "erc20" && lim && out > BigInt(lim))
      add("TOKEN_LIMIT", "deny", `Sends ${fmt(out, c.decimals)} ${c.symbol}, above the ${fmt(BigInt(lim), c.decimals)} limit.`);
    // Drains (almost) the whole balance?
    const bal = balances[i] as bigint | undefined;
    if (bal && bal > 0n && out * 100n >= bal * 90n)
      add("DRAINS_BALANCE", "warn", `Moves ≥90% of the wallet's ${c.symbol} balance in one transaction.`);
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
  // Buying a token that is itself a known scam (a honeypot, a fake, a hacked-account promotion)
  for (const c of inflows) if (c.kind !== "native" && isBlocklisted(c.asset)) add("BLOCKLISTED_TOKEN", "deny", `Buys ${c.symbol} (${short(c.asset)}), a token on the Heimdall blocklist of known scams.`);

  // 4b. Address poisoning: a recipient or spender that looks like an address the wallet trusts, but is not it.
  const familiar = new Set<string>([
    ...Object.keys(KNOWN_CONTRACTS[tx.chainId] ?? {}), ...Object.keys(TOKENS), ...Object.keys(KNOWN_SPENDERS),
    ...policy.trustedRecipients, ...policy.trustedSpenders, ...(policy.allowTargets ?? []), ...(deps.history ?? []),
  ].map(lc));
  const destinations = new Map<string, Address>();
  const dest = (a?: Address | null) => { if (a && !familiar.has(lc(a))) destinations.set(lc(a), a); };
  dest(tx.to);
  for (const a of approvals) if (!a.revoke) dest(a.spender);
  for (const c of changes) if (c.delta < 0n) c.counterparties.forEach(dest);
  if (decoded && /^(transfer|transferFrom)$/.test(decoded.functionName)) for (const arg of decoded.args) if (typeof arg === "string" && /^0x[0-9a-fA-F]{40}$/.test(arg) && lc(arg) !== lc(tx.from)) dest(arg as Address);
  for (const d of destinations.values()) {
    const twin = lookalikeOf(d, familiar);
    if (twin) add("LOOKALIKE_ADDRESS", "deny", `${short(d)} looks like ${short(getAddress(twin))}${deps.history?.some((h) => lc(h) === twin) ? ", an address this wallet used before" : ""}, but it is a different address. This is address poisoning: check every character.`);
  }

  // 5a. Fake tokens: a known ticker or name at the wrong address, wherever the token shows up in this call.
  const tokensTouched = new Map<string, Address>();
  const touchToken = (a?: Address | null) => { if (a && lc(a) !== lc(NATIVE_ASSET)) tokensTouched.set(lc(a), a); };
  for (const c of changes) if (c.kind === "erc20") touchToken(c.asset);
  for (const a of approvals) touchToken(a.token);
  if (tx.to && decoded && /^(approve|transfer|transferFrom|permit|increaseAllowance)$/.test(decoded.functionName)) touchToken(tx.to);
  const fakesP = Promise.all([...tokensTouched.values()].slice(0, 6).map(async (t) => ({ t, f: await fakeTokenCheck(client, t) })));
  const unknownIn = inflows.filter((c) => c.kind === "erc20" && !knownContract(tx.chainId, c.asset));
  const sourceOf = (token: Address) => sim.transfers.find((t) => lc(t.asset) === lc(token) && lc(t.to) === lc(tx.from) && lc(t.from) !== lc(tx.from))?.from;
  const probesP = sim.ok && unknownIn.length
    ? Promise.all([
      probeTransferability(client, tx, unknownIn.map((c) => ({ token: c.asset, amount: c.delta }))),
      Promise.all(unknownIn.slice(0, 3).map((c) => probeReceivedToken(client, tx, c.asset, c.delta, sourceOf(c.asset)))),
    ])
    : null;
  const fakes = await fakesP;
  for (const { t, f } of fakes) {
    if (!f) continue;
    if (f.by === "symbol") add("FAKE_TOKEN", "deny", `${short(t)} calls itself ${f.symbol}, but the real ${f.symbol} is ${short(f.real)}. A copy with the same ticker is a common scam.`);
    else add("FAKE_TOKEN", "warn", `${short(t)} uses the name of ${f.symbol} but is not the real ${f.symbol} (${short(f.real)}).`);
  }

  // 5b. Tokens that arrive and are taken back in the same transaction: you pay and end up with nothing.
  for (const v of vanishing(sim, tx.from)) {
    if (knownContract(tx.chainId, v.token)) continue;
    const meta = await tokenMeta(client, tx.chainId, v.token);
    add("VANISHING_TOKEN", outflows.length ? "deny" : "warn", `${meta.symbol} arrives in the wallet and is taken out again in the same transaction${outflows.length ? ", so you pay and keep nothing" : ""}. This is the vanishing-token scam.`);
  }

  // 5c. Can the agent move, sell and keep what it receives? (honeypots, sell blocks, taxes, allowance backdoors)
  if (probesP) {
    const [probes, deep] = await probesP;
    const taxFinding = (sym: string, sent: bigint, received: bigint, what: string) => {
      if (sent <= 0n || received >= sent) return;
      const taxBps = Number(((sent - received) * 10_000n) / sent);
      const pct = (taxBps / 100).toFixed(1);
      if (taxBps >= 5_000) add("TRANSFER_TAX", "deny", `${sym} takes a ${pct}% tax ${what}.`);
      else if (taxBps >= 500) add("TRANSFER_TAX", "warn", `${sym} takes a ${pct}% tax ${what}.`);
      else add("TRANSFER_TAX", "info", `${sym} takes a ${pct}% tax ${what}.`);
    };
    const symOf = (t: Address) => unknownIn.find((c) => lc(c.asset) === lc(t))?.symbol ?? short(t);
    const honeypot = new Set<string>();
    for (const p of probes) {
      if (!p.ok) { honeypot.add(lc(p.token)); add("HONEYPOT", "deny", `The ${symOf(p.token)} you receive cannot be moved again (${p.reason}). Likely a honeypot.`); continue; }
      taxFinding(symOf(p.token), p.sent, p.received, "on every transfer");
    }
    for (const d of deep) {
      const sym = symOf(d.token);
      if (d.sell && !honeypot.has(lc(d.token))) {
        if (!d.sell.ok) add("HONEYPOT", "deny", `The ${sym} you receive can be moved but not sold back to its pool (${d.sell.reason}). This is a sell-blocking honeypot.`);
        else if (!F.some((f) => f.code === "TRANSFER_TAX" && f.message.startsWith(sym))) taxFinding(sym, d.amount, d.sell.received, "when you sell");
      }
      if (d.pulledBy.length) {
        const who = d.pulledBy.map((a) => (lc(a) === lc(STRANGER) ? "anyone" : `its owner ${short(a)}`)).join(" and ");
        add("ALLOWANCE_BYPASS", "deny", `${sym} lets ${who} take it out of your wallet without your approval. The tokens can be clawed back after you buy.`);
      }
    }
  }

  // 6. Verdict
  const verdict = verdictOf(F, policy);
  const summary: string[] = [];
  summary.push(decoded ? `Calls ${decoded.signature} on ${label(tx.chainId, tx.to)}` : tx.data === "0x" ? `Plain transfer to ${label(tx.chainId, tx.to)}` : `Calls unknown function ${tx.data.slice(0, 10)} on ${label(tx.chainId, tx.to)}`);
  summary.push(...authLines);
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
