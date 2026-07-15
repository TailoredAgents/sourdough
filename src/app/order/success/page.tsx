import Link from "next/link";
import { CheckCircle2, Mail, ShoppingBag } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { getOrderConfirmationBySessionId } from "@/lib/order-records";
import {
  getCustomerOrderStatusLabel,
  getCustomerOrderStatusMessage,
} from "@/lib/order-status";
import { formatCurrency } from "@/lib/utils";

export const metadata = {
  title: "Order Received",
  robots: {
    index: false,
    follow: false,
  },
};

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
    <>
      <SiteHeader />
      <main id="main-content" className="bg-[#fffaf2]">
        <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-md border border-stone-200 bg-white p-6 shadow-sm">
              <CheckCircle2 className="text-[#23443b]" size={44} />
              <h1 className="mt-5 text-3xl font-bold text-stone-950">
                {isRequest ? "Request received" : "Order received"}
              </h1>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                {isRequest
                  ? "We will reply with availability before this becomes a confirmed order."
                  : isDemo
                    ? "Demo checkout completed. No payment was collected."
                    : "A confirmation email will be sent after payment is confirmed."}
              </p>
              <div className="mt-5 grid gap-3 text-sm">
                <Link
                  href="/#order"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#23443b] px-4 font-bold text-white"
                >
                  <ShoppingBag size={16} />
                  Back to weekly menu
                </Link>
                <a
                  href={`mailto:${bakery.orderEmail}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 font-bold text-[#23443b]"
                >
                  <Mail size={16} />
                  Contact the bakery
                </a>
              </div>
            </div>

            <div className="rounded-md border border-stone-200 bg-white p-6 shadow-sm">
              {order ? (
                <div className="grid gap-4 text-left text-sm text-stone-700">
                  <div className="rounded-md border border-stone-200 bg-[#fffaf2] p-4">
                    <p className="font-semibold text-stone-950">
                      Order #{order.id.slice(0, 8)} -{" "}
                      {getCustomerOrderStatusLabel(order.status)}
                    </p>
                    <p className="mt-2 leading-6">
                      {getCustomerOrderStatusMessage(order.status)}
                    </p>
                    <p className="mt-1">{order.customerName}</p>
                    <p className="mt-1">{order.deliveryWindow}</p>
                    <p className="mt-1">{order.deliveryAddress}</p>
                    {order.deliveryInstructions ? (
                      <p className="mt-1">
                        Instructions: {order.deliveryInstructions}
                      </p>
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
                <div className="rounded-md border border-stone-200 bg-[#fffaf2] p-4 text-sm leading-6 text-stone-700">
                  <p className="font-bold text-stone-950">What happens next</p>
                  <p className="mt-2">
                    Keep an eye on your email for confirmation or follow-up. If
                    your delivery details need a correction, email{" "}
                    <a
                      href={`mailto:${bakery.orderEmail}`}
                      className="font-bold text-[#23443b] underline"
                    >
                      {bakery.orderEmail}
                    </a>
                    .
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
