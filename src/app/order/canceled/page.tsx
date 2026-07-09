import Link from "next/link";
import { cancelPendingOrderByToken } from "@/lib/order-records";

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
    <main className="flex min-h-screen items-center justify-center bg-[#fffaf2] px-4">
      <div className="max-w-lg rounded-md border border-stone-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-3xl font-bold text-stone-950">Checkout canceled</h1>
        <p className="mt-3 text-sm leading-6 text-stone-700">
          {released
            ? "Your pending order was canceled and reserved inventory was released."
            : "Your order was not completed. You can return to the weekly menu and try again while inventory remains available."}
        </p>
        <Link
          href="/#order"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-[#23443b] px-4 text-sm font-bold text-white"
        >
          Back to order
        </Link>
      </div>
    </main>
  );
}
