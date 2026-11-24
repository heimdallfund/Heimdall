import process from "node:process";
// @ts-expect-error built by scripts/bundle.mjs on install (one file: handler, MCP server and SDK)
import { handle } from "../build/handler.mjs";

export const maxDuration = 60;
const run = (request: Request): Promise<Response> => handle(request, process.env);
export { run as GET, run as POST, run as OPTIONS, run as DELETE };
