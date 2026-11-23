"use client";
import { Providers } from "./Providers";
import { ConnectButton } from "./ConnectButton";

/** The header's wallet button, with its own wallet context (loaded only inside the app area). */
export default function HeaderWallet() {
  return <Providers><ConnectButton /></Providers>;
}
