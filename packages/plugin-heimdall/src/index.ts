import { heimdallPlugin } from "@heimdall/agent-kit/eliza";

/** Heimdall for ElizaOS. Settings come from the character or env: HEIMDALL_API_URL, HEIMDALL_API_KEY, HEIMDALL_PAY_ADDRESS. */
export const plugin = heimdallPlugin();
export default plugin;
export { heimdallPlugin };
