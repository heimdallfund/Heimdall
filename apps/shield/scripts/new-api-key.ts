/** Usage: npx tsx scripts/new-api-key.ts <name>
 *  Prints a new API key (give it to the customer once) and the SHIELD_API_KEYS entry (store only the hash). */
import { randomBytes, createHash } from "node:crypto";
const name = process.argv[2];
if (!name || !/^[a-z0-9_-]{2,40}$/i.test(name)) throw new Error("usage: new-api-key.ts <name> (letters, digits, - or _)");
const key = `hd_live_${randomBytes(24).toString("base64url")}`;
const hash = createHash("sha256").update(key).digest("hex");
console.log(`API key (share once, never stored): ${key}`);
console.log(`Add to SHIELD_API_KEYS:            ${name}:${hash}`);
