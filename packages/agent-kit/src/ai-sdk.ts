import { tool, type ToolSet } from "ai";
import { heimdallTools, type AgentKitOptions } from "./tools.js";

/**
 * Heimdall tools for the Vercel AI SDK.
 *
 *   const result = await generateText({ model, tools: heimdallAiTools({ wallet }), prompt });
 *
 * `heimdall_safe_send` asks for approval first when `approveSends` is true (the default): the AI SDK pauses with a
 * tool-approval request your app shows to the user.
 */
export function heimdallAiTools(opts: AgentKitOptions & { approveSends?: boolean } = {}): ToolSet {
  const set: ToolSet = {};
  for (const t of heimdallTools(opts)) {
    set[t.name] = tool({
      description: t.description,
      inputSchema: t.schema,
      needsApproval: t.sendsFunds ? (opts.approveSends ?? true) : false,
      execute: (input) => t.run(input as never),
    });
  }
  return set;
}

export { heimdallTools, compactCheck, type AgentKitOptions, type HeimdallTool } from "./tools.js";
