import { ImageResponse } from "next/og";
import { isAddress } from "viem";
import { fetchAgentStats } from "@/lib/shield";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Heimdall agent profile";

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const s = isAddress(address) ? await fetchAgentStats(address) : null;
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const stat = (k: string, v: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "22px 28px", background: "#FFFFFF", border: "2px solid #E6E8EE", borderRadius: 18, flex: 1 }}>
      <div style={{ display: "flex", fontSize: 22, color: "#525B6E" }}>{k}</div><div style={{ display: "flex", fontSize: 48, fontWeight: 800 }}>{v}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(180deg,#EEF1FF 0%,#FFFFFF 65%)", fontFamily: "sans-serif", color: "#1B2233" }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>Heimdall · Agent profile</div>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 800 }}>{short}</div>
        <div style={{ display: "flex", gap: 20 }}>{stat("Shield checks", String(s?.checks ?? 0))}{stat("Unsafe stopped", String(s?.denied ?? 0))}{stat("Allowed", s?.checks ? `${Math.round((s.allowed / s.checks) * 100)}%` : "—")}</div>
      </div>
    ),
    size,
  );
}
