import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getOrderConfirmationBySessionId } from "@/lib/order-records";
import { formatCurrency } from "@/lib/utils";

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    session_id?: string;
    request_id?: string;
    demo?: string;
  }>;
}) {
  const params = await searchParams;
  const order = params.session_id
    ? await getOrderConfirmationBySessionId(params.session_id)
    : null;
  const isRequest = Boolean(params.request_id);
  const isDemo = params.demo === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffaf2] px-4">
      <div className="w-full max-w-2xl rounded-md border border-stone-200 bg-white p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto text-[#23443b]" size={44} />
        <h1 className="mt-5 text-3xl font-bold text-stone-950">
          {isRequest ? "Request received" : "Order received"}
        </h1>
        {order ? (
          <div className="mt-5 grid gap-4 text-left text-sm text-stone-700">
            <div className="rounded-md border border-stone-200 bg-[#fffaf2] p-4">
              <p className="font-semibold text-stone-950">
                Order #{order.id.slice(0, 8)} - {order.status.replace(/_/g, " ")}
              </p>
              <p className="mt-1">{order.customerName}</p>
              <p className="mt-1">{order.deliveryWindow}</p>
              <p className="mt-1">{order.deliveryAddress}</p>
              {order.deliveryInstructions ? (
                <p className="mt-1">Instructions: {order.deliveryInstructions}</p>
              ) : null}
            </div>
            <div className="rounded-md border border-stone-200 p-4">
              <p className="font-semibold text-stone-950">Order</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">
                {order.orderSummary}
              </pre>
              <div className="mt-4 grid gap-1 border-t border-stone-200 pt-3">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(order.subtotalCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Delivery</span>
                  <span>{formatCurrency(order.deliveryFeeCents)}</span>
                </div>
                <div className="flex justify-between font-bold text-stone-950">
                  <span>Total</span>
                  <span>{formatCurrency(order.totalCents)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-stone-700">
            {isRequest
              ? "Your last-minute request was saved. The bakery will confirm what is possible before it becomes an order."
              : isDemo
                ? "Demo checkout completed. No payment was collected."
                : "Thank you for supporting Luna & Lorelai's Sourdough. A confirmation email will be sent after payment is confirmed."}
          </p>
        )}
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-[#23443b] px-4 text-sm font-bold text-white"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
