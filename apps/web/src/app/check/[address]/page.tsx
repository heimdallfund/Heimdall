import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ScanLoader } from "@/components/Motif";
import { notFound } from "next/navigation";
import { getAddress, isAddress, type Address } from "viem";
import { Providers } from "@/components/Providers";
import { explorerAddress, short } from "@/lib/config";
import { WalletReport } from "./WalletReport";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return { title: `Wallet Check · ${isAddress(address) ? short(address) : "invalid"}`, description: "Live token approvals of this wallet, ranked by risk.", robots: { index: false } };
}

export default function Page({ params }: { params: Promise<{ address: string }> }) {
  return <Suspense fallback={<div className="flex justify-center py-24"><ScanLoader /></div>}><Content params={params} /></Suspense>;
}

async function Content({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  const a = getAddress(address) as Address;
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-5 pb-16 pt-12 md:px-8">
      <div className="flex flex-col gap-2">
        <Link href="/check" className="text-[14px] font-medium text-brand hover:underline">← Wallet Check</Link>
        <h1 className="text-[38px] md:text-[47px]">Approvals of <a href={explorerAddress(a)} target="_blank" rel="noopener" className="font-mono text-[0.8em] hover:underline">{short(a)}</a></h1>
      </div>
      <Providers><WalletReport address={a} /></Providers>
    </div>
  );
}
