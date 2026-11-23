// Vercel / serverless entry: the Hono app as the default export.
import { buildApp } from "./server.js";

const app = buildApp();
export default app;
