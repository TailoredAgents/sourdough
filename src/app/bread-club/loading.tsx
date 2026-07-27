import { BreadClubEnrollmentLoading } from "@/components/bread-club-enrollment-loading";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function BreadClubLoading() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="bg-[#fffaf2]">
        <section className="border-b border-stone-200 bg-white py-12 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-bold uppercase text-[#a94334]">
              Sunday Bread Club
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-bold text-stone-950 sm:text-5xl">
              Fresh bread already planned for Sunday
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-stone-700">
              Choose a four-week plan, reserve your loaves, and keep every
              Sunday delivery in one simple account.
            </p>
          </div>
        </section>
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <BreadClubEnrollmentLoading />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
