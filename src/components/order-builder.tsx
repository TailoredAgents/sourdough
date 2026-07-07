"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, Minus, Plus, Send } from "lucide-react";
import type { DeliveryAddress, DeliveryWindow, MenuProduct } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";

type DeliveryCheck = {
  eligible: boolean;
  needsReview: boolean;
  miles: number | null;
  message: string;
  feeCents: number;
};

export function OrderBuilder({
  deliveryWindows,
  afterCutoff,
  menu,
}: {
  deliveryWindows: DeliveryWindow[];
  afterCutoff: boolean;
  menu: MenuProduct[];
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [address, setAddress] = useState<DeliveryAddress>({
    line1: "",
    line2: "",
    city: "Canton",
    state: "GA",
    postalCode: "",
  });
  const [deliveryWindowId, setDeliveryWindowId] = useState(
    deliveryWindows[0]?.id || "",
  );
  const [notes, setNotes] = useState("");
  const [deliveryCheck, setDeliveryCheck] = useState<DeliveryCheck | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const cart = useMemo(
    () =>
      Object.entries(quantities)
        .map(([productId, quantity]) => ({ productId, quantity }))
        .filter((item) => item.quantity > 0),
    [quantities],
  );

  const subtotal = cart.reduce((sum, item) => {
    const product = menu.find((entry) => entry.id === item.productId);
    return sum + (product?.priceCents || 0) * item.quantity;
  }, 0);

  const deliveryFee = deliveryCheck?.eligible ? deliveryCheck.feeCents : 0;
  const total = subtotal + deliveryFee;

  function updateQuantity(productId: string, delta: number, max: number) {
    setQuantities((current) => {
      const next = Math.max(0, Math.min((current[productId] || 0) + delta, max));
      return { ...current, [productId]: next };
    });
  }

  function checkDelivery() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/delivery/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(address),
      });
      const payload = (await response.json()) as DeliveryCheck;
      setDeliveryCheck(payload);
    });
  }

  function submitOrder() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart,
          customer,
          address,
          deliveryWindowId,
          notes,
        }),
      });
      const payload = (await response.json()) as {
        url?: string;
        error?: string;
        message?: string;
      };

      if (!response.ok || !payload.url) {
        setMessage(payload.error || payload.message || "Order could not be started.");
        return;
      }

      window.location.href = payload.url;
    });
  }

  const canCheckout =
    cart.length > 0 &&
    customer.name &&
    customer.email &&
    customer.phone &&
    address.line1 &&
    address.city &&
    address.state &&
    address.postalCode &&
    deliveryWindowId &&
    deliveryCheck?.eligible &&
    !afterCutoff;

  return (
    <section id="order" className="bg-white py-16 sm:py-20">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
            Weekly bake
          </p>
          <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
            Reserve next week&apos;s bread
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-stone-700">
            Choose from the current bake drop. Quantities are limited so the
            bakery can keep quality high and delivery sane.
          </p>

          <div className="mt-8 grid gap-4">
            {menu.map((item) => {
              const quantity = quantities[item.id] || 0;
              return (
                <article
                  key={item.id}
                  className="grid gap-4 rounded-md border border-stone-200 bg-[#fffaf2] p-4 sm:grid-cols-[140px_1fr_auto]"
                >
                  {item.imageUrl ? (
                    <div className="relative min-h-32 overflow-hidden rounded-md bg-stone-100">
                      <Image
                        src={item.imageUrl}
                        alt={item.name}
                        fill
                        sizes="140px"
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div
                      className={`min-h-32 rounded-md bg-gradient-to-br ${item.imageStyle}`}
                    />
                  )}
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-stone-950">{item.name}</h3>
                      <span className="rounded-sm bg-white px-2 py-1 text-xs font-semibold uppercase tracking-wide text-stone-600">
                        {item.category === "bread" ? "Bread" : "Add-on"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      {item.description}
                    </p>
                    <p className="mt-3 text-sm text-stone-600">
                      Allergens: {item.allergens.join(", ")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#23443b]">
                      {item.remainingQuantity} left this week
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                    <p className="text-lg font-bold text-stone-950">
                      {formatCurrency(item.priceCents)}
                    </p>
                    <div className="flex h-10 items-center overflow-hidden rounded-md border border-stone-300 bg-white">
                      <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        className="flex size-10 items-center justify-center text-stone-700 hover:bg-stone-100"
                        onClick={() => updateQuantity(item.id, -1, item.remainingQuantity)}
                      >
                        <Minus size={16} />
                      </button>
                      <span className="w-8 text-center text-sm font-bold">{quantity}</span>
                      <button
                        type="button"
                        aria-label={`Add ${item.name}`}
                        className="flex size-10 items-center justify-center text-stone-700 hover:bg-stone-100"
                        onClick={() => updateQuantity(item.id, 1, item.remainingQuantity)}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="h-fit rounded-md border border-stone-200 bg-[#f7efe3] p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-stone-950">Checkout details</h3>
              <p className="mt-1 text-sm text-stone-700">
                Delivery is radius-based from Canton, GA.
              </p>
            </div>
            <span className="rounded-sm bg-white px-2 py-1 text-xs font-bold uppercase text-[#a94334]">
              {afterCutoff ? "Request only" : "Open"}
            </span>
          </div>

          {afterCutoff ? (
            <div className="mt-5 rounded-md border border-[#a94334]/25 bg-white p-4 text-sm leading-6 text-stone-700">
              The Thursday deadline has passed. Use the notes field and send a
              last-minute request; normal checkout will reopen for the next bake.
            </div>
          ) : null}

          <div className="mt-5 grid gap-3">
            <input
              className="h-11 rounded-md border border-stone-300 px-3 text-sm"
              placeholder="Name"
              value={customer.name}
              onChange={(event) =>
                setCustomer((current) => ({ ...current, name: event.target.value }))
              }
            />
            <input
              className="h-11 rounded-md border border-stone-300 px-3 text-sm"
              placeholder="Email"
              type="email"
              value={customer.email}
              onChange={(event) =>
                setCustomer((current) => ({ ...current, email: event.target.value }))
              }
            />
            <input
              className="h-11 rounded-md border border-stone-300 px-3 text-sm"
              placeholder="Phone"
              value={customer.phone}
              onChange={(event) =>
                setCustomer((current) => ({ ...current, phone: event.target.value }))
              }
            />
            <input
              className="h-11 rounded-md border border-stone-300 px-3 text-sm"
              placeholder="Street address"
              value={address.line1}
              onChange={(event) =>
                setAddress((current) => ({ ...current, line1: event.target.value }))
              }
            />
            <div className="grid grid-cols-[1fr_72px_100px] gap-2">
              <input
                className="h-11 rounded-md border border-stone-300 px-3 text-sm"
                placeholder="City"
                value={address.city}
                onChange={(event) =>
                  setAddress((current) => ({ ...current, city: event.target.value }))
                }
              />
              <input
                className="h-11 rounded-md border border-stone-300 px-3 text-sm"
                placeholder="State"
                value={address.state}
                onChange={(event) =>
                  setAddress((current) => ({ ...current, state: event.target.value }))
                }
              />
              <input
                className="h-11 rounded-md border border-stone-300 px-3 text-sm"
                placeholder="ZIP"
                value={address.postalCode}
                onChange={(event) =>
                  setAddress((current) => ({
                    ...current,
                    postalCode: event.target.value,
                  }))
                }
              />
            </div>
            <Button type="button" variant="secondary" onClick={checkDelivery}>
              {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
              Check delivery radius
            </Button>
            {deliveryCheck ? (
              <div className="flex gap-2 rounded-md bg-white p-3 text-sm text-stone-700">
                {deliveryCheck.eligible ? (
                  <CheckCircle2 className="mt-0.5 text-[#23443b]" size={18} />
                ) : (
                  <AlertCircle className="mt-0.5 text-[#a94334]" size={18} />
                )}
                <p>{deliveryCheck.message}</p>
              </div>
            ) : null}

            <select
              className="h-11 rounded-md border border-stone-300 px-3 text-sm"
              value={deliveryWindowId}
              onChange={(event) => setDeliveryWindowId(event.target.value)}
            >
              {deliveryWindows.map((window) => (
                <option key={window.id} value={window.id}>
                  {window.label} ({window.capacity - window.reserved} spots)
                </option>
              ))}
            </select>
            <textarea
              className="min-h-24 rounded-md border border-stone-300 p-3 text-sm"
              placeholder="Notes, delivery details, or last-minute request"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="mt-5 space-y-2 border-t border-stone-300 pt-4 text-sm text-stone-700">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Delivery</span>
              <span>{deliveryFee ? formatCurrency(deliveryFee) : "Check address"}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-stone-950">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          <p className="mt-4 text-xs leading-5 text-stone-600">
            By continuing, you confirm the delivery details are correct and you
            have reviewed the listed ingredients, allergens, and{" "}
            <Link
              href="/policies/terms"
              className="font-bold text-[#23443b] underline"
            >
              order terms
            </Link>
            .
          </p>

          <Button
            type="button"
            className="mt-5 w-full"
            variant={afterCutoff ? "secondary" : "primary"}
            disabled={afterCutoff ? cart.length === 0 : !canCheckout || isPending}
            onClick={submitOrder}
          >
            {isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
            {afterCutoff ? "Send request" : "Continue to Stripe Checkout"}
          </Button>
          {message ? <p className="mt-3 text-sm text-[#a94334]">{message}</p> : null}
        </aside>
      </div>
    </section>
  );
}
