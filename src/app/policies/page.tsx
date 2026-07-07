import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  officialComplianceLinks,
  policyLastUpdated,
  policyPages,
} from "@/lib/policies";

export const metadata: Metadata = {
  title: "Policies",
  description:
    "L&L Sourdough customer policies, cottage food notice, privacy terms, and refund information.",
};

export default function PoliciesPage() {
  return (
    <>
      <SiteHeader />
      <main className="bg-[#fffaf2]">
        <section className="border-b border-stone-200 bg-white py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
              Customer policies
            </p>
            <h1 className="mt-3 text-4xl font-bold text-stone-950 sm:text-5xl">
              Policies and bakery notices
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-stone-700">
              These pages set expectations for local delivery, allergens,
              refunds, privacy, and order handling. They should be reviewed
              before launch with the owner, accountant, and any required local
              business contacts.
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
            <h2 className="text-2xl font-bold text-stone-950">
              Official references
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-700">
              These links are planning references for launch readiness. They do
              not replace owner review or professional guidance.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {officialComplianceLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-[#fffaf2] p-4 text-sm font-semibold text-stone-800 hover:border-[#23443b]"
                >
                  {link.label}
                  <ExternalLink size={16} />
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
