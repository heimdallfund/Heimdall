import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ADDRESSES } from "@/lib/config";
import { Providers } from "@/components/Providers";
import { LaunchBanner } from "@/components/Preview";
import { ScanLoader } from "@/components/Motif";
import { JobView } from "./JobView";

export const metadata: Metadata = { title: "Escrow job", description: "A Heimdall Pay escrow job between agents.", robots: { index: false } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<div className="flex justify-center py-24"><ScanLoader /></div>}><Content params={params} /></Suspense>;
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-5 pb-16 pt-12 md:px-8">
      <div className="flex flex-col gap-2"><Link href="/app/pay" className="text-[14px] font-medium text-brand hover:underline">← Escrow jobs</Link>
        <h1 className="text-[38px]">Job #{id}</h1></div>
      {ADDRESSES.pay ? <Providers><JobView pay={ADDRESSES.pay} id={BigInt(id)} /></Providers> : <LaunchBanner>Heimdall Pay opens with the mainnet launch.</LaunchBanner>}
    </div>
  );
}
