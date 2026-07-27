import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck2, Mail } from "lucide-react";
import { Suspense } from "react";
import { BreadClubEnrollment } from "@/components/bread-club-enrollment";
import { BreadClubEnrollmentLoading } from "@/components/bread-club-enrollment-loading";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  isBreadClubAutomaticTaxEnabled,
  isBreadClubPublicEnabled,
} from "@/lib/bread-club/config";
import { getBreadClubEnrollmentData } from "@/lib/bread-club/data";
import { getCurrentAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const publicEnabled = isBreadClubPublicEnabled();
  return {
    title: "Sunday Bread Club | Luna & Lorelai's Sourdough",
    description:
      "Four-week prepaid sourdough membership with Sunday delivery in Canton, Holly Springs, and Woodstock, Georgia.",
    robots: publicEnabled
      ? { index: true, follow: true }
      : { index: false, follow: false },
  };
}

async function BreadClubEnrollmentSection({
  preview,
}: {
  preview: boolean;
}) {
  const data = await getBreadClubEnrollmentData();
  const previewAdmin =
    preview &&
    !data.publicEnabled &&
    process.env.NODE_ENV === "production"
      ? await getCurrentAdmin()
      : null;
  const previewEmail =
    preview && !data.publicEnabled
      ? process.env.NODE_ENV !== "production"
        ? "member@example.com"
        : previewAdmin?.email || null
      : null;
  const enrollmentVisible = data.publicEnabled || Boolean(previewEmail);

  if (enrollmentVisible) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <BreadClubEnrollment
          data={data}
          automaticTaxEnabled={isBreadClubAutomaticTaxEnabled()}
          previewEmail={previewEmail}
        />
      </div>
    );
  }

  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-3xl font-bold text-stone-950">
          {preview
            ? "Sign in to run the owner checkout test"
            : "Enrollment opens after the final billing review"}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-stone-700">
          {preview
            ? "The protected preview uses your approved admin email so the test checkout cannot be opened by a customer."
            : "The four-week plans and member tools are ready, but new public charges remain paused until the bakery finishes its tax and final checkout verification."}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {preview ? (
            <Link
              href="/admin/login"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#23443b] px-5 text-sm font-bold text-white"
            >
              Sign in as owner
              <ArrowRight size={17} />
            </Link>
          ) : (
            <Link
              href="/#order"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#23443b] px-5 text-sm font-bold text-white"
            >
              Order this Sunday
              <ArrowRight size={17} />
            </Link>
          )}
          <Link
            href="/bread-club/manage"
            className="inline-flex h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-5 text-sm font-bold text-stone-800"
          >
            Manage existing membership
          </Link>
        </div>
      </div>
    </section>
  );
}

export default async function BreadClubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const preview = params.preview === "1";
  const canceled = params.canceled === "1";
  const publicEnabled = isBreadClubPublicEnabled();

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="bg-[#fffaf2]">
        <section className="border-b border-stone-200 bg-white py-12 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-bold uppercase text-[#a94334]">
              Sunday Bread Club
            </p>
            <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_0.55fr] lg:items-end">
              <div>
                <h1 className="max-w-3xl text-4xl font-bold text-stone-950 sm:text-5xl">
                  Fresh bread already planned for Sunday
                </h1>
                <p className="mt-4 max-w-2xl text-lg leading-8 text-stone-700">
                  Choose a four-week plan, reserve your loaves, and keep every
                  Sunday delivery in one simple account.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  {publicEnabled || preview ? (
                    <a
                      href="#bread-club-enrollment"
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#a94334] px-5 text-base font-bold text-white transition hover:bg-[#8d372a]"
                    >
                      Start my membership
                      <ArrowRight size={18} />
                    </a>
                  ) : null}
                  <Link
                    href="/bread-club/manage"
                    className="inline-flex h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-5 text-base font-bold text-stone-800 transition hover:bg-stone-50"
                  >
                    Manage membership
                  </Link>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm font-semibold text-stone-700 lg:justify-end">
                <span className="inline-flex items-center gap-2">
                  <CalendarCheck2 size={18} className="text-[#23443b]" />
                  Sunday 3:00-6:00 PM
                </span>
                <span className="inline-flex items-center gap-2">
                  <Mail size={18} className="text-[#23443b]" />
                  Passwordless account access
                </span>
              </div>
            </div>
          </div>
        </section>

        {canceled ? (
          <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
            <div className="border border-stone-300 bg-white p-4 text-sm text-stone-700">
              Enrollment checkout was canceled. Any temporary Sunday
              reservations were released and no Bread Club charge was made.
            </div>
          </div>
        ) : null}

        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
              <BreadClubEnrollmentLoading />
            </div>
          }
        >
          <BreadClubEnrollmentSection preview={preview} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
