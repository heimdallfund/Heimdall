"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PUBLIC_API_URL } from "@/lib/config";
import { ALL_STEPS, PHASES } from "./steps";

type Done = Record<string, { at: number; note?: string }>;

const LOCAL = "heimdall-launch-checklist";
const ADMIN_KEY = "heimdall-admin-key";
const utc = (ms: number) => new Date(ms).toISOString().slice(5, 16).replace("T", " ") + " UTC";

function readLocal(): Done {
  try { return JSON.parse(localStorage.getItem(LOCAL) ?? "{}") as Done; } catch { return {}; }
}
function writeLocal(d: Done) {
  try { localStorage.setItem(LOCAL, JSON.stringify(d)); } catch { /* private mode */ }
}

/** Ticks are kept in this browser and, with the admin key open in this tab, on the Shield API so every device sees them. */
export function LaunchChecklist() {
  const [done, setDone] = useState<Done>({});
  const [synced, setSynced] = useState<"local" | "server" | "error">("local");
  const [key, setKey] = useState<string | null>(null);

  const api = useCallback(async (init?: RequestInit) => {
    const r = await fetch(`${PUBLIC_API_URL}/v1/admin/launch`, { ...init, headers: { "content-type": "application/json", "x-admin-key": key ?? "" } });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as Done;
  }, [key]);

  useEffect(() => {
    setDone(readLocal());
    try { setKey(sessionStorage.getItem(ADMIN_KEY)); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    if (!key) return;
    api().then((server) => {
      // the server copy wins for every step it knows; steps ticked only here are kept and pushed up
      setDone((local) => {
        const merged = { ...local, ...server };
        if (Object.keys(merged).length !== Object.keys(server).length) api({ method: "PUT", body: JSON.stringify(merged) }).catch(() => setSynced("error"));
        writeLocal(merged);
        return merged;
      });
      setSynced("server");
    }).catch(() => setSynced("error"));
  }, [key, api]);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = { at: Date.now() };
      writeLocal(next);
      if (key) api({ method: "PUT", body: JSON.stringify(next) }).then(() => setSynced("server")).catch(() => setSynced("error"));
      return next;
    });
  };

  const total = ALL_STEPS.length;
  const count = useMemo(() => ALL_STEPS.filter((s) => done[s.id]).length, [done]);
  const nextStep = ALL_STEPS.find((s) => !done[s.id]);

  return (
    <div className="flex flex-col gap-8">
      <div className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-[28px] font-bold tracking-[-0.02em]">{count} / {total}</p>
          <p className="text-[13px] text-muted">
            {synced === "server" ? "Saved on the Shield API: every device sees these ticks." : synced === "error" ? "Could not reach the Shield API: saved in this browser only." : "Saved in this browser. Open the admin panel with your key to keep it on every device."}
          </p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-ice" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count} aria-label="Launch progress">
          <div className="h-full bg-brand transition-transform duration-300" style={{ width: "100%", transform: `translateX(-${100 - (count / total) * 100}%)` }} />
        </div>
        <p className="text-[14px]">{nextStep ? <>Next: <span className="font-semibold">{nextStep.title}</span></> : <span className="font-semibold text-allow">Every step is done.</span>}</p>
      </div>

      {PHASES.map((phase, i) => {
        const phaseDone = phase.steps.filter((s) => done[s.id]).length;
        return (
          <section key={phase.id} aria-labelledby={`ph-${phase.id}`} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`ph-${phase.id}`} className="text-[20px] font-semibold"><span className="mr-2 font-mono text-[13px] text-muted">0{i + 1}</span>{phase.title}</h2>
              <span className="font-mono text-[12px] text-muted">{phase.when} · {phaseDone}/{phase.steps.length}</span>
            </div>
            <ol className="card divide-y divide-line overflow-hidden">
              {phase.steps.map((s) => {
                const d = done[s.id];
                return (
                  <li key={s.id} className="flex gap-4 p-4">
                    <input id={`st-${s.id}`} type="checkbox" checked={!!d} onChange={() => toggle(s.id)} className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" />
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <label htmlFor={`st-${s.id}`} className={`cursor-pointer font-semibold ${d ? "text-muted line-through" : ""}`}>{s.title}</label>
                      <p className="text-[14px] leading-relaxed text-muted">{s.detail}</p>
                      {s.code && <code className="block overflow-x-auto whitespace-pre rounded-md bg-ink px-3 py-2 font-mono text-[12.5px] text-paper">{s.code}</code>}
                      {d && <p className="text-[12px] text-allow">Done {utc(d.at)}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
