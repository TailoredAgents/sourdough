import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Bread Club Enrollment Received",
  robots: { index: false, follow: false },
};

export default function BreadClubSuccessPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="bg-[#fffaf2] py-20">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <CheckCircle2 size={42} className="text-[#23443b]" />
          <h1 className="mt-5 text-4xl font-bold text-stone-950">
            Your Bread Club enrollment is processing
          </h1>
          <p className="mt-4 text-base leading-7 text-stone-700">
            Stripe will confirm payment, then we will email your first four
            reserved Sundays and a secure link to manage selections, skips,
            add-ons, billing, and cancellation.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/bread-club/manage"
              className="inline-flex h-11 items-center justify-center rounded-md bg-[#23443b] px-5 text-sm font-bold text-white"
            >
              Access membership
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-5 text-sm font-bold text-stone-800"
            >
              Return to storefront
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
