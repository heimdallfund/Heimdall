import {
  type Address, type Hex, type TypedDataDefinition,
  bytesToHex, getAddress, hashTypedData, hexToBytes, keccak256, recoverAddress, serializeSignature,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";

/** Anything that can sign the Shield receipt (EIP-712). */
export interface ReceiptSigner {
  kind: "local" | "kms" | "ephemeral";
  address: Address;
  signTypedData(def: TypedDataDefinition): Promise<Hex>;
}

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// ───────────────────────────── DER helpers ─────────────────────────────

function readLen(b: Uint8Array, i: number): [number, number] {
  const first = b[i]!;
  if (first < 0x80) return [first, i + 1];
  const n = first & 0x7f;
  let len = 0;
  for (let k = 0; k < n; k++) len = (len << 8) | b[i + 1 + k]!;
  return [len, i + 1 + n];
}

/** Parse a DER ECDSA signature `SEQUENCE { INTEGER r, INTEGER s }`. */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("bad DER: no sequence");
  [, i] = readLen(der, i);
  const readInt = (): bigint => {
    if (der[i++] !== 0x02) throw new Error("bad DER: no integer");
    let len: number;
    [len, i] = readLen(der, i);
    const v = der.slice(i, i + len);
    i += len;
    return BigInt(bytesToHex(v));
  };
  const r = readInt();
  const s = readInt();
  return { r, s };
}

/** Extract the 65-byte uncompressed secp256k1 key from a DER SubjectPublicKeyInfo and derive the address. */
export function addressFromSpki(spki: Uint8Array): Address {
  // The BIT STRING holding the key ends the structure: 0x03 len 0x00 0x04 X(32) Y(32)
  const idx = spki.length - 65;
  if (spki[idx] !== 0x04) throw new Error("unexpected public key encoding");
  const xy = spki.slice(idx + 1);
  return getAddress(`0x${keccak256(xy).slice(-40)}`);
}

// ───────────────────────────── Signers ─────────────────────────────

export function localSigner(pk: Hex, kind: "local" | "ephemeral" = "local"): ReceiptSigner {
  const account = privateKeyToAccount(pk);
  return { kind, address: account.address, signTypedData: (def) => account.signTypedData(def as never) };
}

export interface KmsLike {
  send(cmd: GetPublicKeyCommand | SignCommand): Promise<{ PublicKey?: Uint8Array; Signature?: Uint8Array }>;
}

/** AWS KMS key spec ECC_SECG_P256K1, usage SIGN_VERIFY. The private key never leaves KMS. */
export async function kmsSigner(keyId: string, kms: KmsLike = new KMSClient({})): Promise<ReceiptSigner> {
  const pub = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
  if (!pub.PublicKey) throw new Error("KMS returned no public key");
  const address = addressFromSpki(pub.PublicKey);
  return {
    kind: "kms",
    address,
    async signTypedData(def) {
      const digest = hashTypedData(def as never);
      const out = await kms.send(new SignCommand({
        KeyId: keyId, Message: hexToBytes(digest), MessageType: "DIGEST", SigningAlgorithm: "ECDSA_SHA_256",
      }));
      if (!out.Signature) throw new Error("KMS returned no signature");
      let { r, s } = parseDerSignature(out.Signature);
      if (s > N / 2n) s = N - s; // EIP-2: low-s only
      const rHex = `0x${r.toString(16).padStart(64, "0")}` as Hex;
      const sHex = `0x${s.toString(16).padStart(64, "0")}` as Hex;
      for (const yParity of [0, 1] as const) {
        const sig = serializeSignature({ r: rHex, s: sHex, yParity });
        if ((await recoverAddress({ hash: digest, signature: sig })) === address) return sig;
      }
      throw new Error("could not recover KMS signature");
    },
  };
}

let cached: Promise<ReceiptSigner> | undefined;

/**
 * Pre-launch mode (SHIELD_PRELAUNCH=1): the API runs in production and answers every check, but signs no receipts,
 * because no contract trusts a signer yet. Setting the KMS key ends it; a SHIELD_SIGNER_KEY does not, so the key can
 * be put in place before launch and receipts start only when SHIELD_PRELAUNCH is removed.
 */
export function prelaunch(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHIELD_PRELAUNCH === "1" && !env.SHIELD_KMS_KEY_ID;
}

/**
 * SHIELD_KMS_KEY_ID → AWS KMS (preferred) · SHIELD_SIGNER_KEY → key held in a sensitive env var (production until KMS,
 * then dev/staging) · neither → ephemeral key, refused when NODE_ENV=production. Contracts can rotate the trusted
 * signer through the admin Safe, so moving from an env key to KMS needs no redeploy.
 */
export function getSigner(env: NodeJS.ProcessEnv = process.env): Promise<ReceiptSigner> {
  if (!cached) {
    cached = (async () => {
      if (prelaunch(env)) throw new Error("Pre-launch mode: receipts are not signed until launch (remove SHIELD_PRELAUNCH or set SHIELD_KMS_KEY_ID)");
      if (env.SHIELD_KMS_KEY_ID) return kmsSigner(env.SHIELD_KMS_KEY_ID);
      if (env.SHIELD_SIGNER_KEY) return localSigner(env.SHIELD_SIGNER_KEY as Hex);
      if (env.NODE_ENV === "production") throw new Error("No receipt signer configured: set SHIELD_KMS_KEY_ID or SHIELD_SIGNER_KEY");
      return localSigner(generatePrivateKey(), "ephemeral");
    })();
    cached.catch(() => { cached = undefined; });
  }
  return cached;
}

/** Test hook. */
export function resetSigner() {
  cached = undefined;
}
