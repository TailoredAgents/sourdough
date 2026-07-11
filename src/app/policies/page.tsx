import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { policyLastUpdated, policyPages } from "@/lib/policies";

export const metadata: Metadata = {
  title: "Policies",
  description:
    "Luna & Lorelai's Sourdough customer policies for local delivery, allergens, cottage-food notices, privacy, refunds, and order terms.",
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

      </main>
      <SiteFooter />
    </>
  );
}
