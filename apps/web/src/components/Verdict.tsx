export type VerdictKind = "ALLOW" | "WARN" | "DENY" | "INFO" | "PASS";

const styles: Record<VerdictKind, string> = {
  ALLOW: "bg-allow-soft text-allow",
  PASS: "bg-allow-soft text-allow",
  WARN: "bg-warn-soft text-warn",
  DENY: "bg-deny-soft text-deny",
  INFO: "bg-[#EEF2F7] text-[#3A4560]",
};

export function VerdictBadge({ kind, size = "sm" }: { kind: VerdictKind; size?: "sm" | "lg" }) {
  return (
    <span className={`${styles[kind]} inline-flex items-center font-mono font-bold uppercase ${size === "lg" ? "display border-2 border-current px-5 py-2.5 text-[36px] shadow-[3px_3px_0_currentColor]" : "px-2 py-0.5 text-[11px] tracking-[0.08em]"}`}>
      {kind}
    </span>
  );
}
