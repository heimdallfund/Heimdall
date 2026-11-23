import { z } from "zod";
import type { Action, ActionParameter, ActionResult, IAgentRuntime, Plugin } from "@elizaos/core";
import type { Address } from "viem";
import { heimdallTools, type AgentKitOptions, type HeimdallTool } from "./tools.js";

const upper = (n: string) => n.toUpperCase();

/** Top-level fields of a tool's zod schema as ElizaOS action parameters (JSON Schema per field). */
export function toActionParameters(t: HeimdallTool): ActionParameter[] {
  const js = z.toJSONSchema(t.schema) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  return Object.entries(js.properties ?? {}).map(([name, schema]) => ({
    name,
    description: String(schema.description ?? name),
    required: js.required?.includes(name) ?? false,
    schema: schema as ActionParameter["schema"],
  }));
}

function toAction(t: HeimdallTool): Action {
  return {
    name: upper(t.name),
    description: t.description,
    similes: [t.name, t.name.replace("heimdall_", "").replace(/_/g, " ")],
    parameters: toActionParameters(t),
    validate: async () => true,
    handler: async (_runtime, _message, _state, options, callback): Promise<ActionResult> => {
      const params = ((options as { parameters?: Record<string, unknown> } | undefined)?.parameters ?? {}) as Record<string, unknown>;
      const parsed = t.schema.safeParse(params);
      if (!parsed.success) return { success: false, text: `${t.name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
      try {
        const data = await t.run(parsed.data as never);
        const text = JSON.stringify(data);
        await callback?.({ text, actions: [upper(t.name)] });
        return { success: true, text, data: data as ActionResult["data"] };
      } catch (e) {
        return { success: false, text: `${t.name} failed: ${(e as Error).message}` };
      }
    },
  };
}

/**
 * Heimdall as an ElizaOS plugin. Settings are read from the character or env when the plugin starts:
 * HEIMDALL_API_URL, HEIMDALL_API_KEY, HEIMDALL_PAY_ADDRESS. Pass a wallet in code to enable HEIMDALL_SAFE_SEND.
 *
 *   plugins: [heimdallPlugin()]
 */
export function heimdallPlugin(opts: AgentKitOptions = {}): Plugin {
  const actions: Action[] = [];
  const plugin: Plugin = {
    name: "heimdall",
    description: "Heimdall Shield checks every transaction and signature before the agent signs, plus Heimdall Pay escrow lookups on Robinhood Chain.",
    actions,
    init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
      const get = (k: string) => (config[k] ?? runtime.getSetting(k) ?? undefined) as string | undefined;
      const tools = heimdallTools({
        baseUrl: get("HEIMDALL_API_URL"),
        apiKey: get("HEIMDALL_API_KEY"),
        payAddress: get("HEIMDALL_PAY_ADDRESS") as Address | undefined,
        ...opts,
      });
      actions.splice(0, actions.length, ...tools.map(toAction));
    },
  };
  // Available before init too, with the options given in code.
  actions.push(...heimdallTools(opts).map(toAction));
  return plugin;
}

export { heimdallTools, compactCheck, type AgentKitOptions, type HeimdallTool } from "./tools.js";
