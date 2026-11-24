import { getAddress, zeroAddress } from "viem";
import { client } from "@/lib/reads";
import { BATCH_DATA, MULTISEND_CALL_ONLY, NONCE, SAFE, SAFE_ABI } from "@/app/safe-setup/batch";

export const dynamic = "force-dynamic";

/** Admin Safe state for /safe-setup, read server-side over the private RPC (the public one rate-limits phones). */
export async function GET() {
  try {
    const [owners, threshold, nonce, hash] = await Promise.all([
      client.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getOwners" }),
      client.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getThreshold" }),
      client.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "nonce" }),
      client.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getTransactionHash", args: [MULTISEND_CALL_ONLY, 0n, BATCH_DATA, 1, 0n, 0n, 0n, zeroAddress, zeroAddress, NONCE] }),
    ]);
    const flags = await Promise.all(owners.map((o) => client.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "approvedHashes", args: [o, hash] })));
    return Response.json({
      owners: owners.map((o) => getAddress(o)), threshold: Number(threshold), nonce: Number(nonce), hash,
      approved: owners.filter((_, i) => flags[i] > 0n).map((o) => getAddress(o)),
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "rpc" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
