import Link from "next/link";
import { Mail, ShoppingBag, XCircle } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { cancelPendingOrderByToken } from "@/lib/order-records";

export const metadata = {
  title: "Checkout Canceled",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function OrderCanceledPage({
  searchParams,
}: {
  searchParams: Promise<{ order_id?: string; token?: string }>;
}) {
  const params = await searchParams;
  let released = false;

  if (params.order_id && params.token) {
    try {
      released = Boolean(
        await cancelPendingOrderByToken(params.order_id, params.token),
      );
    } catch (error) {
      console.error("[checkout] cancel release failed", error);
    }
  }

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="bg-[#fffaf2]">
        <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <div className="mx-auto grid max-w-4xl gap-6 rounded-md border border-stone-200 bg-white p-6 shadow-sm md:grid-cols-[0.8fr_1.2fr]">
            <div>
              <XCircle className="text-[#a94334]" size={44} />
              <h1 className="mt-5 text-3xl font-bold text-stone-950">
                Checkout canceled
              </h1>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                {released
                  ? "Your pending order was canceled and reserved inventory was released."
                  : "Your order was not completed. You can return to the weekly menu and try again while inventory remains available."}
              </p>
            </div>

            <div className="rounded-md border border-stone-200 bg-[#fffaf2] p-4">
              <p className="font-bold text-stone-950">Next steps</p>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                If checkout closed unexpectedly, return to the order form while
                inventory is still available. For payment or delivery questions,
                email the bakery directly.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Link
                  href="/#order"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#23443b] px-4 text-sm font-bold text-white"
                >
                  <ShoppingBag size={16} />
                  Back to order
                </Link>
                <a
                  href={`mailto:${bakery.orderEmail}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-bold text-[#23443b]"
                >
                  <Mail size={16} />
                  Contact bakery
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
