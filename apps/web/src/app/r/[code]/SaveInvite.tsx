"use client";
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveRef } from "@/lib/referral";

export function SaveInvite({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  useEffect(() => { saveRef(code.toLowerCase()); router.replace("/early"); }, [code, router]);
  return null;
}
