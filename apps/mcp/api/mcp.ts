import process from "node:process";
import { handle } from "../src/handler.js";

export const maxDuration = 60;
const run = (request: Request) => handle(request, process.env);
export { run as GET, run as POST, run as OPTIONS, run as DELETE };
