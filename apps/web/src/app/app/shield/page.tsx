import type { Metadata } from "next";
import { ShieldConsole } from "./ShieldConsole";

export const metadata: Metadata = { title: "Shield console" };

export default function Page() {
  return <ShieldConsole />;
}
