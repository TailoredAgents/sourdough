import Link from "next/link";
import { bakery } from "@/lib/bakery-data";
import { policyPages } from "@/lib/policies";

export function SiteFooter() {
  return (
    <footer className="border-t border-stone-200 bg-[#fffaf2]">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_0.8fr] lg:px-8">
        <div>
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-[#23443b] text-lg font-bold text-white">
              L&L
            </span>
            <span>
              <span className="block text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Sourdough
              </span>
              <span className="block text-xs text-stone-600">{bakery.location}</span>
            </span>
          </Link>
          <p className="mt-4 max-w-xl text-sm leading-6 text-stone-700">
            Weekly sourdough drops and small-batch add-ons for local delivery
            from Canton, Georgia.
          </p>
        </div>

        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-stone-500">
            Policies
          </p>
          <nav className="mt-3 grid gap-2 text-sm font-semibold text-stone-700">
            <Link href="/policies">Policy overview</Link>
            {policyPages.map((page) => (
              <Link key={page.slug} href={`/policies/${page.slug}`}>
                {page.title}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
