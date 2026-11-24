import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { H1, H2, Code, Note, C } from "@/components/docs/Docs";
import { PUBLIC_API_URL, SHIELD_API_URL } from "@/lib/config";
import { TryIt } from "./TryIt";

export const metadata: Metadata = { title: "API reference", description: "Every public endpoint of the Heimdall Shield API, generated from the OpenAPI 3.1 spec, with a live Try it for each." };

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; default?: unknown; description?: string; pattern?: string; enum?: unknown[]; anyOf?: Schema[]; items?: Schema; maxLength?: number; $ref?: string };
type Op = { tags?: string[]; operationId: string; summary: string; description?: string; parameters?: { name: string; in: string; schema: Schema }[]; requestBody?: { content: Record<string, { schema: Schema; examples?: Record<string, { value: unknown }> }> }; responses: Record<string, { description: string }> };
type Spec = { info: { version: string }; tags: { name: string; description: string }[]; paths: Record<string, Partial<Record<"get" | "post", Op>>> };

const typeOf = (s: Schema): string => {
  if (s.$ref) return s.$ref.split("/").pop()!;
  if (s.enum) return s.enum.map(String).join(" | ");
  if (s.anyOf) return [...new Set(s.anyOf.map(typeOf))].join(" | ");
  if (s.type === "array") return `${s.items ? typeOf(s.items) : "any"}[]`;
  return Array.isArray(s.type) ? s.type.join(" | ") : s.type ?? "any";
};

function Fields({ schema }: { schema: Schema }) {
  const props = Object.entries(schema.properties ?? {});
  if (!props.length) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[480px] text-left text-[13.5px]">
        <thead><tr className="bg-ice text-[12px] text-muted"><th className="px-3 py-2 font-medium">Field</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Default</th></tr></thead>
        <tbody>{props.map(([k, v]) => (
          <tr key={k} className="border-t border-line">
            <td className="px-3 py-2 font-mono">{k}{schema.required?.includes(k) && <span className="ml-1 text-deny" title="required">*</span>}</td>
            <td className="px-3 py-2 font-mono text-muted">{typeOf(v)}</td>
            <td className="px-3 py-2 font-mono text-muted">{v.default === undefined ? "" : JSON.stringify(v.default)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const sampleBody = (op: Op) => {
  const c = op.requestBody?.content["application/json"];
  const ex = c?.examples ? Object.values(c.examples)[0]?.value : undefined;
  if (ex) return JSON.stringify(ex, null, 2);
  if (op.operationId === "checkSignature") return JSON.stringify({ chainId: 4663, signer: "0x1111111111111111111111111111111111111111", message: "Sign in to example.com" }, null, 2);
  return "{}";
};
const samplePath = (path: string) => path.replace("{address}", "0x281FF81dF0Eca1F3F7Ba2A48499c7A83D216a2A8").replace("{id}", "1");

async function loadSpec(): Promise<Spec | null> {
  "use cache";
  // A miss is cached only for minutes, so the page recovers soon after Shield answers again.
  const spec = await fetch(`${SHIELD_API_URL}/openapi.json`, { signal: AbortSignal.timeout(6_000) })
    .then((r) => (r.ok ? (r.json() as Promise<Spec>) : null)).catch(() => null);
  if (spec) cacheLife("hours"); else cacheLife("minutes");
  return spec;
}

export default async function Page() {
  const spec = await loadSpec();
  const ops = spec ? Object.entries(spec.paths).flatMap(([path, m]) => (Object.entries(m) as ["get" | "post", Op][]).map(([method, op]) => ({ path, method, op }))) : [];
  return (
    <>
      <H1 lead={<>Every public endpoint of the Shield API, generated from its OpenAPI 3.1 spec. Base URL <C>{PUBLIC_API_URL}</C>.</>}>API reference</H1>
      <p>Point any OpenAPI tool at the spec to get a client in your language, or hand it to an agent: <a className="text-brand underline underline-offset-2" href={`${PUBLIC_API_URL}/openapi.json`}>{PUBLIC_API_URL}/openapi.json</a> (also at <a className="text-brand underline underline-offset-2" href="/openapi.json">heimdall.fund/openapi.json</a>).</p>
      <Code lang="bash">{`npx @openapitools/openapi-generator-cli generate -i ${PUBLIC_API_URL}/openapi.json -g python -o heimdall-client`}</Code>
      <H2 id="a2a">Agent2Agent (A2A)</H2>
      <p>Agents that speak A2A can delegate a check as a task. The agent card is at <a className="text-brand underline underline-offset-2" href={`${PUBLIC_API_URL}/.well-known/agent-card.json`}>{PUBLIC_API_URL}/.well-known/agent-card.json</a>; send <C>SendMessage</C> over JSON-RPC to <C>{`${PUBLIC_API_URL}/a2a`}</C> with a data part. The task comes back completed, with the verdict as data and as one readable line. Free tier, x402 and API keys work the same as on the REST routes.</p>
      <Code lang="json">{`{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"1","role":"ROLE_USER",
  "parts":[{"data":{"from":"0x…","to":"0x…","data":"0x…","value":"0"},"mediaType":"application/json"}]}}}`}</Code>
      <Note>No key needed for the free tier. Above it, the API answers 402 with a <C>PAYMENT-REQUIRED</C> header: pay per call in USDG with x402, or send an API key as <C>x-api-key</C>. See <a className="text-brand underline underline-offset-2" href="/docs/limits">API keys & limits</a>.</Note>
      {!spec && <Note>The spec could not be loaded right now. It is always at {PUBLIC_API_URL}/openapi.json.</Note>}
      {spec?.tags.map((tag) => {
        const inTag = ops.filter((o) => o.op.tags?.includes(tag.name));
        if (!inTag.length) return null;
        return (
          <section key={tag.name} className="flex flex-col gap-6">
            <H2 id={tag.name.toLowerCase()}>{tag.name}</H2>
            <p className="-mt-3 text-muted">{tag.description}</p>
            {inTag.map(({ path, method, op }) => {
              const body = op.requestBody?.content["application/json"]?.schema;
              return (
                <article key={op.operationId} id={op.operationId} className="flex scroll-mt-24 flex-col gap-3 border-t border-line pt-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 font-mono text-[12px] font-bold ${method === "post" ? "bg-brand text-white" : "bg-allow-soft text-allow"}`}>{method.toUpperCase()}</span>
                    <code className="break-all font-mono text-[15px] font-semibold">{path}</code>
                  </div>
                  <h3 className="text-[17px] font-semibold">{op.summary}</h3>
                  {op.description && <p className="text-[15px] leading-relaxed text-muted">{op.description}</p>}
                  {op.parameters?.length ? <p className="text-[14px]">Path: {op.parameters.map((p) => <C key={p.name}>{p.name}</C>)}</p> : null}
                  {body && <Fields schema={body} />}
                  <p className="text-[13px] text-muted">Responses: {Object.entries(op.responses).map(([code, r]) => <span key={code} title={r.description} className="mr-2 font-mono">{code}</span>)}</p>
                  <TryIt method={method === "post" ? "POST" : "GET"} path={samplePath(path)} body={method === "post" ? sampleBody(op) : undefined} />
                </article>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
