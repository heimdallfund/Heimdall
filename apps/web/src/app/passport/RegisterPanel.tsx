"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, parseAbi, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ERC8004 } from "@/lib/config";
import { ConnectButton } from "@/components/ConnectButton";

const IDENTITY = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

/** Register an agent in the official ERC-8004 Identity Registry (from the user's wallet), then link it to Heimdall. */
export function RegisterPanel() {
  const { address } = useAccount();
  const pc = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const router = useRouter();
  const [mode, setMode] = useState<"register" | "link">("register");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mcp, setMcp] = useState("");
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function link(owner: Address, id: string) {
    const res = await fetch("/api/passport/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: owner, agentId: id }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error === "not_owner_or_agent_wallet" ? "This wallet does not own that agent, and is not its registered agent wallet." : j.error === "agent_not_found" ? "No agent with that id in the ERC-8004 registry." : "Linking failed. Try again in a moment.");
    router.push(`/agent/${owner}`);
  }

  async function register() {
    if (!address || !pc) return;
    setErr(null);
    try {
      if (!name.trim()) throw new Error("Give your agent a name.");
      const registration = {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        name: name.trim().slice(0, 80),
        description: description.trim().slice(0, 500),
        services: mcp.trim() ? [{ name: "MCP", endpoint: mcp.trim() }] : [],
        x402Support: false,
        active: true,
        supportedTrust: ["reputation"],
      };
      const uri = `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(registration))))}`;
      setBusy("Confirm in your wallet…");
      const hash = await writeContractAsync({ address: ERC8004.identity, abi: IDENTITY, functionName: "register", args: [uri] });
      setBusy("Registering onchain…");
      const rc = await pc.waitForTransactionReceipt({ hash });
      const log = rc.logs.map((l) => { try { return decodeEventLog({ abi: IDENTITY, ...l }); } catch { return null; } }).find((e) => e?.eventName === "Registered");
      const id = log && "agentId" in log.args ? String(log.args.agentId) : null;
      if (!id) throw new Error("Registered, but the agent id could not be read. Link it below with its id.");
      setBusy("Linking to Heimdall…");
      await link(address, id);
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    }
    setBusy(null);
  }

  async function linkExisting() {
    if (!address) return;
    setErr(null);
    try {
      if (!/^\d{1,30}$/.test(agentId.trim())) throw new Error("Enter the numeric agent id.");
      setBusy("Checking ownership onchain…");
      await link(address, agentId.trim());
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  }

  const field = "min-h-11 w-full border border-ink bg-panel px-3 text-[15px] outline-none focus:shadow-[3px_3px_0_var(--color-brand)]";
  return (
    <div className="flex flex-col gap-4 border border-ink bg-panel p-6 shadow-[6px_6px_0_var(--color-ink)]">
      <div className="flex gap-2" role="tablist">
        {(["register", "link"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`tag border ${mode === m ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"}`}>{m === "register" ? "New agent" : "Already registered"}</button>
        ))}
      </div>
      {!address ? (
        <div className="flex flex-col gap-3"><p className="text-[15px] text-muted">Connect the wallet that owns (or will own) the agent.</p><ConnectButton /></div>
      ) : mode === "register" ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold">Agent name<input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Momentum agent" /></label>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold">What it does<textarea className={`${field} min-h-20 py-2`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Buys NVDA dips with a 2% daily loss cap." /></label>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold">MCP endpoint (optional)<input className={field} value={mcp} onChange={(e) => setMcp(e.target.value)} placeholder="https://…/mcp" spellCheck={false} /></label>
          <button type="button" disabled={!!busy} onClick={register} className="btn btn-primary disabled:opacity-60">{busy ?? "Register and link"}</button>
          <p className="text-[12.5px] text-muted">One transaction to the official ERC-8004 Identity Registry ({ERC8004.identity.slice(0, 10)}…). The agent NFT is yours; Heimdall never holds it.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold">ERC-8004 agent id<input className={field} inputMode="numeric" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="42" /></label>
          <button type="button" disabled={!!busy} onClick={linkExisting} className="btn btn-primary disabled:opacity-60">{busy ?? "Link to my wallet"}</button>
          <p className="text-[12.5px] text-muted">No signature needed: Heimdall reads the registry and only links when this wallet owns the agent or is its registered agent wallet.</p>
        </div>
      )}
      {err && <p className="text-[14px] text-deny">{err}</p>}
    </div>
  );
}
