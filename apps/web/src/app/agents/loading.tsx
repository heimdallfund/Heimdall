import { ScanLoader } from "@/components/Motif";

export default function Loading() {
  return <div className="mx-auto max-w-[1240px] px-6"><ScanLoader label="Reading Robinhood Chain…" /></div>;
}
