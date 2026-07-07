import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { buttonClassName } from "./button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-[#fffaf2]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-[#23443b] text-lg font-bold text-white">
            L&L
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
              Sourdough
            </span>
            <span className="block text-xs text-stone-600">Canton, Georgia</span>
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
