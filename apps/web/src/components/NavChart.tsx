import type { NavPoint } from "@/lib/history";

/** Share-price line from the 15-minute snapshots. Pure SVG, rendered on the server. */
export function NavChart({ points }: { points: NavPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-line-strong text-sm text-muted">
        The chart fills in from the first snapshots (every 15 minutes).
      </div>
    );
  }
  const W = 720, H = 240, P = 36, PR = 64;
  const t0 = points[0]!.t, t1 = points.at(-1)!.t;
  const ys = points.map((p) => p.pps);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo) * 0.15 || 0.01;
  const yMin = lo - pad, yMax = hi + pad;
  const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - P - PR);
  const y = (v: number) => H - P - ((v - yMin) / (yMax - yMin)) * (H - P * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.pps).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)} ${H - P} L${x(t0).toFixed(1)} ${H - P} Z`;
  const up = ys.at(-1)! >= ys[0]!;
  const fmt = (t: number) => (t1 - t0 < 86_400_000 ? new Date(t).toISOString().slice(11, 16) + " UTC" : new Date(t).toISOString().slice(5, 10));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Share price from ${ys[0]!.toFixed(4)} to ${ys.at(-1)!.toFixed(4)} USDG`}>
      <defs><linearGradient id="navfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3355FF" stopOpacity="0.18" /><stop offset="1" stopColor="#3355FF" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map((f) => {
        const v = yMin + (yMax - yMin) * f;
        return <g key={f}><line x1={P} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#E4E9F7" /><text x={W - PR + 8} y={y(v) + 4} fontSize="11" fill="#5A6683">{v.toFixed(3)}</text></g>;
      })}
      <path d={area} fill="url(#navfill)" />
      <path d={line} fill="none" stroke={up ? "#3355FF" : "#B42318"} strokeWidth="2.2" strokeLinejoin="round" />
      <text x={P} y={H - 12} fontSize="11" fill="#5A6683">{fmt(t0)}</text>
      <text x={W - PR} y={H - 12} fontSize="11" fill="#5A6683" textAnchor="end">{fmt(t1)}</text>
    </svg>
  );
}
