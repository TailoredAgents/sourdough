import Link from "next/link";
import Image from "next/image";
import { ShoppingBag } from "lucide-react";
import { buttonClassName } from "./button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-[#fffaf2]/90 backdrop-blur">
      <a
        href="#main-content"
        className="absolute -top-16 left-4 z-50 rounded-md bg-white px-3 py-2 text-sm font-bold text-[#23443b] shadow-sm transition-all focus:top-2"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="relative flex size-11 shrink-0 overflow-hidden rounded-full border border-amber-200 bg-white shadow-sm">
            <Image
              src="/images/luna-lorelais-logo-square-180.png"
              alt="Luna & Lorelai's Sourdough logo"
              fill
              sizes="44px"
              className="object-cover"
              priority
            />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-bold uppercase tracking-[0.12em] text-[#a94334]">
              Luna &amp; Lorelai&apos;s
            </span>
            <span className="hidden text-xs text-stone-600 sm:block">
              Sourdough - Canton, Georgia
            </span>
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-stone-700 md:flex">
          <Link
            href="/#menu"
            data-analytics-event="nav_click"
            data-analytics-label="Weekly menu"
            data-analytics-section="header"
          >
            Weekly menu
          </Link>
          <Link
            href="/sourdough-delivery-canton-ga"
            data-analytics-event="nav_click"
            data-analytics-label="Delivery"
            data-analytics-section="header"
          >
            Delivery
          </Link>
          <Link
            href="/#questions"
            data-analytics-event="nav_click"
            data-analytics-label="Questions"
            data-analytics-section="header"
          >
            Questions
          </Link>
          <Link
            href="/contact"
            data-analytics-event="nav_click"
            data-analytics-label="Contact"
            data-analytics-section="header"
          >
            Contact
          </Link>
          <Link
            href="/policies"
            data-analytics-event="nav_click"
            data-analytics-label="Policies"
            data-analytics-section="header"
          >
            Policies
          </Link>
        </nav>
        <Link
          href="/#order"
          data-analytics-event="order_cta_click"
          data-analytics-label="Order"
          data-analytics-section="header"
          className={buttonClassName({ variant: "warm", size: "sm" })}
        >
          <ShoppingBag size={16} />
          Order
        </Link>
      </div>
      <nav
        aria-label="Mobile navigation"
        className="grid grid-cols-5 gap-2 border-t border-stone-200 px-4 py-2 text-center text-[0.8rem] font-bold text-stone-700 md:hidden"
      >
        <Link
          href="/#menu"
          data-analytics-event="nav_click"
          data-analytics-label="Weekly menu"
          data-analytics-section="mobile_header"
          className="rounded-sm bg-white px-2 py-2"
        >
          Menu
        </Link>
        <Link
          href="/sourdough-delivery-canton-ga"
          aria-label="Delivery"
          data-analytics-event="nav_click"
          data-analytics-label="Delivery"
          data-analytics-section="mobile_header"
          className="rounded-sm bg-white px-2 py-2"
        >
          Area
        </Link>
        <Link
          href="/#questions"
          aria-label="Questions"
          data-analytics-event="nav_click"
          data-analytics-label="Questions"
          data-analytics-section="mobile_header"
          className="rounded-sm bg-white px-2 py-2"
        >
          FAQ
        </Link>
        <Link
          href="/policies"
          aria-label="Policies"
          data-analytics-event="nav_click"
          data-analytics-label="Policies"
          data-analytics-section="mobile_header"
          className="rounded-sm bg-white px-2 py-2"
        >
          Policy
        </Link>
        <Link
          href="/contact"
          aria-label="Contact"
          data-analytics-event="nav_click"
          data-analytics-label="Contact"
          data-analytics-section="mobile_header"
          className="rounded-sm bg-white px-2 py-2"
        >
          Help
        </Link>
      </nav>
    </header>
  );
}
