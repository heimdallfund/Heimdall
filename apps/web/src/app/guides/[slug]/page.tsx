import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIDES, guide } from "@/lib/guides";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = guide((await params).slug);
  if (!g) return {};
  return { title: g.title, description: g.description, openGraph: { type: "article", title: g.title, description: g.description, modifiedTime: g.updated } };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const g = guide((await params).slug);
  if (!g) notFound();
  const url = `${SITE}/guides/${g.slug}`;
  const ld: Record<string, unknown>[] = [{
    "@context": "https://schema.org", "@type": "Article", headline: g.title, description: g.description, dateModified: g.updated, datePublished: g.updated,
    mainEntityOfPage: url, author: { "@type": "Organization", name: "Heimdall", url: SITE }, publisher: { "@type": "Organization", name: "Heimdall", url: SITE },
  }];
  if (g.steps) ld.push({ "@context": "https://schema.org", "@type": "HowTo", name: g.title, description: g.description, step: g.steps.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text })) });
  const others = GUIDES.filter((x) => x.slug !== g.slug).slice(0, 3);
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-6 pb-24 pt-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <nav aria-label="Breadcrumb" className="text-[14px] text-muted"><Link href="/guides" className="hover:text-ink">Guides</Link> <span aria-hidden="true">/</span> {g.tag}</nav>
      <header className="flex flex-col gap-4">
        <h1 className="text-[38px] font-bold leading-[1.1] tracking-[-0.03em] md:text-[46px]">{g.title}</h1>
        <p className="text-[18px] leading-relaxed text-muted">{g.description}</p>
        <p className="text-[13px] text-muted">Updated {new Date(`${g.updated}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} (UTC) · {g.minutes} min read</p>
      </header>
      <article className="guide-prose">{g.body}</article>
      {g.sources && (
        <section className="rounded-xl border border-line bg-ice p-5 text-[14.5px]">
          <h2 className="mb-2 font-semibold">Sources</h2>
          <ul className="flex flex-col gap-1">{g.sources.map(([t, u]) => <li key={u}><a className="text-brand underline underline-offset-2" href={u} target="_blank" rel="noopener">{t}</a></li>)}</ul>
        </section>
      )}
      <section className="flex flex-col gap-3 border-t border-line pt-8">
        <h2 className="text-[18px] font-semibold">More guides</h2>
        <ul className="flex flex-col gap-2">{others.map((o) => <li key={o.slug}><Link href={`/guides/${o.slug}`} className="text-brand underline underline-offset-2">{o.title}</Link></li>)}</ul>
      </section>
    </div>
  );
}
