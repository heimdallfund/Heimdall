import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { heimdallTools, type AgentKitOptions } from "./tools.js";

/**
 * Heimdall tools for LangChain and LangGraph.
 *
 *   const agent = createReactAgent({ llm, tools: heimdallLangChainTools({ wallet }) });
 *
 * Each tool returns JSON text, which every chat model can read.
 */
export function heimdallLangChainTools(opts: AgentKitOptions = {}): StructuredToolInterface[] {
  return heimdallTools(opts).map((t) =>
    tool(async (input: unknown) => JSON.stringify(await t.run(input as never)), {
      name: t.name,
      description: t.description,
      schema: t.schema,
    }) as unknown as StructuredToolInterface,
  );
}

export { heimdallTools, compactCheck, type AgentKitOptions, type HeimdallTool } from "./tools.js";
