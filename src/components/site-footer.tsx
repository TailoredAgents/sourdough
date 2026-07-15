import Link from "next/link";
import Image from "next/image";
import { Mail } from "lucide-react";
import { bakery } from "@/lib/bakery-data";
import { policyPages } from "@/lib/policies";

export function SiteFooter() {
  return (
    <footer className="border-t border-stone-200 bg-[#fffaf2]">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_0.8fr] lg:px-8">
        <div>
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="relative flex size-12 shrink-0 overflow-hidden rounded-full border border-amber-200 bg-white shadow-sm">
              <Image
                src="/images/luna-lorelais-logo-square-180.png"
                alt="Luna & Lorelai's Sourdough logo"
                fill
                sizes="48px"
                className="object-cover"
              />
            </span>
            <span>
              <span className="block text-sm font-bold uppercase tracking-[0.12em] text-[#a94334]">
                {bakery.name}
              </span>
              <span className="block text-xs text-stone-600">{bakery.location}</span>
            </span>
          </Link>
          <p className="mt-4 max-w-xl text-sm leading-6 text-stone-700">
            Weekly sourdough loaves and small-batch add-ons available by
            preorder for local delivery around Canton and Woodstock, Georgia.
          </p>
          <a
            href={`mailto:${bakery.orderEmail}`}
            className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#23443b] underline"
          >
            <Mail size={16} />
            {bakery.orderEmail}
          </a>
        </div>

        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-stone-500">
            Helpful links
          </p>
          <nav className="mt-3 grid gap-2 text-sm font-semibold text-stone-700">
            <Link href="/sourdough-delivery-canton-ga">
              Sourdough Delivery in Canton, GA
            </Link>
            <Link href="/sourdough-delivery-woodstock-ga">
              Sourdough Delivery in Woodstock, GA
            </Link>
            <Link href="/contact">Contact the bakery</Link>
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
