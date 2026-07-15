import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { buildBreadcrumbList } from "@/lib/breadcrumbs";
import {
  getPolicyPage,
  policyLastUpdated,
  policyLastUpdatedIso,
  policyPages,
} from "@/lib/policies";

type PolicyRouteProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return policyPages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: PolicyRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getPolicyPage(slug);
  if (!page) return {};

  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: `/policies/${page.slug}`,
    },
    openGraph: {
      title: `${page.title} | ${bakery.name}`,
      description: page.description,
      url: `https://${bakery.domain}/policies/${page.slug}`,
      siteName: bakery.name,
      type: "article",
    },
  };
}

export default async function PolicyPage({ params }: PolicyRouteProps) {
  const { slug } = await params;
  const page = getPolicyPage(slug);
  if (!page) notFound();
  const siteUrl = `https://${bakery.domain}`;
  const path = `/policies/${page.slug}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      buildBreadcrumbList(
        [
          { name: "Home", href: "/" },
          { name: "Policies", href: "/policies" },
          { name: page.title, href: path },
        ],
        siteUrl,
      ),
      {
        "@type": "WebPage",
        "@id": `${siteUrl}${path}`,
        name: page.title,
        description: page.description,
        url: `${siteUrl}${path}`,
        dateModified: policyLastUpdatedIso,
        isPartOf: {
          "@type": "WebSite",
          name: bakery.name,
          url: siteUrl,
        },
      },
    ],
  };

  return (
    <>
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <main id="main-content" className="bg-[#fffaf2]">
        <section className="border-b border-stone-200 bg-white py-14">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <Link
              href="/policies"
              className="text-sm font-semibold text-[#a94334]"
            >
              Back to policies
            </Link>
            <h1 className="mt-4 text-4xl font-bold text-stone-950 sm:text-5xl">
              {page.title}
            </h1>
            <p className="mt-4 text-base leading-7 text-stone-700">
              {page.description}
            </p>
            <p className="mt-3 text-sm text-stone-500">
              Last updated: {policyLastUpdated}
            </p>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto grid max-w-4xl gap-5 px-4 sm:px-6 lg:px-8">
            {page.sections.map((section) => (
              <article
                key={section.heading}
                className="rounded-md border border-stone-200 bg-white p-5 shadow-sm"
              >
                <h2 className="text-xl font-bold text-stone-950">
                  {section.heading}
                </h2>
                <div className="mt-3 grid gap-3 text-sm leading-6 text-stone-700">
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
