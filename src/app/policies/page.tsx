import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { buildBreadcrumbList } from "@/lib/breadcrumbs";
import {
  officialComplianceLinks,
  policyLastUpdated,
  policyPages,
} from "@/lib/policies";

const policiesDescription =
  "Luna & Lorelai's Sourdough customer policies for local delivery, allergens, cottage-food notices, privacy, refunds, and order terms.";

export const metadata: Metadata = {
  title: "Policies",
  description: policiesDescription,
  alternates: {
    canonical: "/policies",
  },
  openGraph: {
    title: "Customer Policies | Luna & Lorelai's Sourdough",
    description:
      "Review local delivery, allergen, cottage-food, privacy, refund, and order policies before placing a Canton-area sourdough order.",
    url: `https://${bakery.domain}/policies`,
    siteName: bakery.name,
    type: "website",
  },
};

export default function PoliciesPage() {
  const siteUrl = `https://${bakery.domain}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      buildBreadcrumbList(
        [
          { name: "Home", href: "/" },
          { name: "Policies", href: "/policies" },
        ],
        siteUrl,
      ),
      {
        "@type": "WebPage",
        "@id": `${siteUrl}/policies`,
        name: "Customer Policies",
        description: policiesDescription,
        url: `${siteUrl}/policies`,
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
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
              Customer policies
            </p>
            <h1 className="mt-3 text-4xl font-bold text-stone-950 sm:text-5xl">
              Policies and bakery notices
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-stone-700">
              Review the customer policies for local delivery, allergens,
              Georgia cottage-food notices, refunds, privacy, and order
              handling before placing an order.
            </p>
            <p className="mt-3 text-sm text-stone-500">
              Last updated: {policyLastUpdated}
            </p>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto grid max-w-7xl gap-5 px-4 sm:px-6 md:grid-cols-2 lg:px-8">
            {policyPages.map((page) => (
              <Link
                key={page.slug}
                href={`/policies/${page.slug}`}
                className="rounded-md border border-stone-200 bg-white p-5 shadow-sm transition hover:border-[#23443b]"
              >
                <FileText className="text-[#a94334]" size={22} />
                <h2 className="mt-4 text-xl font-bold text-stone-950">
                  {page.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-700">
                  {page.description}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-t border-stone-200 bg-white py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Official resources
              </p>
              <h2 className="mt-3 text-2xl font-bold text-stone-950">
                Where customers can verify bakery requirements
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                These links go to state and local sources for cottage-food,
                tax, and business-license information. They are provided for
                transparency and do not replace official guidance.
              </p>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {officialComplianceLinks.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  rel="noreferrer"
                  target="_blank"
                  className="rounded-md border border-stone-200 bg-[#fffaf2] p-4 text-sm font-bold text-[#23443b] underline-offset-4 transition hover:border-[#23443b] hover:underline"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
