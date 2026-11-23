import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center gap-5 px-6 py-24 text-center">
      <LogoMark size={72} />
      <h1 className="font-display text-[42px]">Nothing guarded here.</h1>
      <p className="text-muted">This page does not exist, or the vault address is not a Heimdall vault.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white">Home</Link>
        <Link href="/vaults" className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-panel px-5 font-semibold">Vaults</Link>
      </div>
    </div>
  );
}
