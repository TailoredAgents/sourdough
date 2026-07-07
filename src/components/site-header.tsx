import Link from "next/link";
import Image from "next/image";
import { ShoppingBag } from "lucide-react";
import { buttonClassName } from "./button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-[#fffaf2]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="relative flex size-11 shrink-0 overflow-hidden rounded-full border border-amber-200 bg-white shadow-sm">
            <Image
              src="/images/luna-lorelais-logo-square.png"
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
          <Link href="/#menu">Weekly menu</Link>
          <Link href="/#delivery">Delivery</Link>
          <Link href="/#questions">Questions</Link>
          <Link href="/policies">Policies</Link>
          <Link href="/admin">Admin</Link>
        </nav>
        <Link
          href="/#order"
          className={buttonClassName({ variant: "warm", size: "sm" })}
        >
          <ShoppingBag size={16} />
          Order
        </Link>
      </div>
    </header>
  );
}
