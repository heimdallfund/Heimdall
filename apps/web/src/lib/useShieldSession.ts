"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { PUBLIC_API_URL } from "@/lib/config";

/** Wallet sign-in against the Shield API (one signature, no gas). Shared by API keys and drainer reports. */
export function useShieldSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<string | null>(null);
  // A ref as well as state: a caller that signs in and then calls the API in the same handler must send the new token.
  const current = useRef<string | null>(null);
  useEffect(() => { setSession(null); current.current = null; }, [address]);
  const api = useCallback(async (path: string, init?: RequestInit) => {
    const token = current.current;
    const res = await fetch(`${PUBLIC_API_URL}/v1${path}`, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Session ${token}` } : {}), ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
    return body;
  }, []);
  const signIn = useCallback(async () => {
    const { message } = await api("/auth/challenge", { method: "POST", body: JSON.stringify({ address }) });
    const signature = await signMessageAsync({ message });
    const { session: s } = await api("/auth/verify", { method: "POST", body: JSON.stringify({ address, signature }) });
    current.current = s; setSession(s);
    return s as string;
  }, [address, api, signMessageAsync]);
  return { address, session, signIn, api };
}
