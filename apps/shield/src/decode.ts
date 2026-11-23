import { decodeAbiParameters, decodeFunctionData, parseAbi, type Address, type Hex, maxUint256 } from "viem";
import type { ApprovalInfo } from "./types.js";

export const KNOWN_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function increaseApproval(address spender, uint256 addedValue)",
  "function approveAndCall(address spender, uint256 amount, bytes data)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  // Permit2 AllowanceTransfer.approve
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function multicall(bytes[] data)",
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  "function withdraw(uint256 amount)",
  "function deposit()",
  // Heimdall Pay (escrow between agents)
  "function createJob(address provider, address arbiter, uint96 amount, uint64 deadline, uint32 reviewWindow, uint16 arbiterFeeBps, bytes32 specHash)",
  "function release(uint256 id)",
  "function dispute(uint256 id, string reason)",
]);

const MAX_UINT160 = (1n << 160n) - 1n;
/** Anything above 2^128 is treated as "effectively unlimited". */
const UNLIMITED_THRESHOLD = 1n << 128n;

export interface DecodedCall {
  functionName: string;
  signature: string;
  args: readonly unknown[];
}

export function selectorOf(data: Hex): Hex | null {
  return data && data.length >= 10 ? (data.slice(0, 10) as Hex) : null;
}

export function decodeCall(data: Hex): DecodedCall | null {
  if (!data || data === "0x" || data.length < 10) return null;
  try {
    const d = decodeFunctionData({ abi: KNOWN_ABI, data });
    const item = KNOWN_ABI.find(
      (i) => i.type === "function" && i.name === d.functionName && i.inputs.length === (d.args?.length ?? 0),
    );
    const signature = item
      ? `${item.name}(${item.inputs.map((x) => x.type).join(",")})`
      : d.functionName;
    return { functionName: d.functionName, signature, args: d.args ?? [] };
  } catch {
    return null;
  }
}

export function isUnlimited(amount: bigint, standard: ApprovalInfo["standard"]): boolean {
  if (standard === "permit2") return amount >= MAX_UINT160 || amount >= UNLIMITED_THRESHOLD;
  return amount === maxUint256 || amount >= UNLIMITED_THRESHOLD;
}

/** Extract approvals granted directly by the calldata (the target is the token / Permit2). */
export function approvalsFromCall(target: Address | null, decoded: DecodedCall | null): ApprovalInfo[] {
  if (!target || !decoded) return [];
  const a = decoded.args;
  switch (decoded.signature) {
    case "approve(address,uint256)":
    case "increaseAllowance(address,uint256)":
    case "increaseApproval(address,uint256)":
    case "approveAndCall(address,uint256,bytes)": {
      const amount = a[1] as bigint;
      return [{
        standard: "erc20", token: target, spender: a[0] as Address, amount,
        unlimited: isUnlimited(amount, "erc20"), revoke: amount === 0n,
      }];
    }
    case "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)": {
      const amount = a[2] as bigint;
      return [{
        standard: "erc20", token: target, spender: a[1] as Address, amount,
        unlimited: isUnlimited(amount, "erc20"), revoke: amount === 0n,
      }];
    }
    case "approve(address,address,uint160,uint48)": {
      const amount = a[2] as bigint;
      return [{
        standard: "permit2", token: a[0] as Address, spender: a[1] as Address, amount,
        unlimited: isUnlimited(amount, "permit2"), revoke: amount === 0n,
      }];
    }
    case "setApprovalForAll(address,bool)": {
      const approved = a[1] as boolean;
      return [{ standard: "erc721-all", token: target, spender: a[0] as Address, unlimited: approved, revoke: !approved }];
    }
    default:
      return [];
  }
}

// ───────────────────────────── Batched calls ─────────────────────────────

const BATCH_ABI = parseAbi([
  "function multicall(bytes[] data)",
  "function multicall(uint256 deadline, bytes[] data)",
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  "function execute(bytes commands, bytes[] inputs)",
]);

const UR_COMMANDS: Record<number, string> = {
  0x00: "V3 swap (exact in)", 0x01: "V3 swap (exact out)", 0x02: "Permit2 transferFrom", 0x03: "Permit2 permit (batch)",
  0x04: "sweep", 0x05: "transfer", 0x06: "pay portion", 0x08: "V2 swap (exact in)", 0x09: "V2 swap (exact out)",
  0x0a: "Permit2 permit", 0x0b: "wrap ETH", 0x0c: "unwrap WETH", 0x10: "V4 swap",
};

export interface Expanded {
  lines: string[];
  approvals: ApprovalInfo[];
  transfers: { token: Address; to: Address; amount: bigint }[];
}


/** Look inside multicall(...) and Uniswap Universal Router execute(...) for nested approvals and transfers. */
export function expandBatch(target: Address | null, data: Hex, depth = 0): Expanded {
  const out: Expanded = { lines: [], approvals: [], transfers: [] };
  if (!target || depth > 2 || data.length < 10) return out;
  let d: { functionName: string; args?: readonly unknown[] };
  try { d = decodeFunctionData({ abi: BATCH_ABI, data }); } catch { return out; }

  if (d.functionName === "multicall") {
    const calls = (d.args!.length === 2 ? d.args![1] : d.args![0]) as Hex[];
    out.lines.push(`Batch of ${calls.length} call(s)`);
    for (const c of calls) {
      const inner = decodeCall(c);
      out.lines.push(`  · ${inner?.signature ?? c.slice(0, 10)}`);
      out.approvals.push(...approvalsFromCall(target, inner));
      const nested = expandBatch(target, c, depth + 1);
      out.approvals.push(...nested.approvals);
      out.transfers.push(...nested.transfers);
    }
    return out;
  }

  // Universal Router
  const commands = d.args![0] as Hex;
  const inputs = d.args![1] as Hex[];
  const bytes = commands.slice(2).match(/.{2}/g) ?? [];
  out.lines.push(`Universal Router: ${bytes.length} command(s)`);
  bytes.forEach((b, i) => {
    const cmd = parseInt(b, 16) & 0x3f;
    out.lines.push(`  · ${UR_COMMANDS[cmd] ?? `command 0x${cmd.toString(16)}`}`);
    const input = inputs[i];
    if (!input) return;
    try {
      if (cmd === 0x0a) {
        const [ps] = decodeAbiParameters(
          [{ type: "tuple", components: [{ name: "details", type: "tuple", components: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }] }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }] }, { type: "bytes" }],
          input,
        ) as unknown as [{ details: { token: Address; amount: bigint }; spender: Address }];
        out.approvals.push({ standard: "permit2", token: ps.details.token, spender: ps.spender, amount: ps.details.amount, unlimited: isUnlimited(ps.details.amount, "permit2"), revoke: ps.details.amount === 0n });
      } else if (cmd === 0x03) {
        const [pb] = decodeAbiParameters(
          [{ type: "tuple", components: [{ name: "details", type: "tuple[]", components: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }] }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }] }, { type: "bytes" }],
          input,
        ) as unknown as [{ details: { token: Address; amount: bigint }[]; spender: Address }];
        for (const det of pb.details) out.approvals.push({ standard: "permit2", token: det.token, spender: pb.spender, amount: det.amount, unlimited: isUnlimited(det.amount, "permit2"), revoke: det.amount === 0n });
      } else if (cmd === 0x05) {
        const [token, to, amount] = decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], input) as [Address, Address, bigint];
        out.transfers.push({ token, to, amount });
      }
    } catch { /* undecodable input: the simulation still shows the real effect */ }
  });
  return out;
}
