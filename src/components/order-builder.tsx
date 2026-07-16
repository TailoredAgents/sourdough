"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Send,
  ShoppingBag,
} from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import {
  canOrderMenuProduct,
  getMenuProductAvailabilityLabel,
} from "@/lib/menu-availability";
import { getProductGuidance } from "@/lib/product-guidance";
import { productPath } from "@/lib/product-slugs";
import type { DeliveryAddress, DeliveryWindow, MenuProduct } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";
import { ProductUnavailableOverlay } from "./product-unavailable-overlay";

type DeliveryCheck = {
  eligible: boolean;
  needsReview: boolean;
  miles: number | null;
  message: string;
  feeCents: number;
  postalCode: string | null;
  allowedPostalCodes: string[];
};

type CheckoutStartResponse = {
  url?: string;
  error?: string;
  message?: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function countDigits(value: string) {
  return value.replace(/\D/g, "").length;
}

function normalizeStateInput(value: string) {
  const letters = value.replace(/[^a-z]/gi, "").toUpperCase();
  if ("GEORGIA".startsWith(letters) && letters.length >= 3) return "GA";
  return letters.slice(0, 2);
}

export function OrderBuilder({
  deliveryWindows,
  afterCutoff,
  menu,
}: {
  deliveryWindows: DeliveryWindow[];
  afterCutoff: boolean;
  menu: MenuProduct[];
}) {
  const availableDeliveryWindows = deliveryWindows.filter(
    (window) => window.reserved < window.capacity,
  );
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
    availableDeliveryWindows[0]?.id || "",
  );
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [acknowledgedTerms, setAcknowledgedTerms] = useState(false);
  const [deliveryCheck, setDeliveryCheck] = useState<DeliveryCheck | null>(null);
  const [deliveryCheckNeedsRefresh, setDeliveryCheckNeedsRefresh] =
    useState(false);
  const [prefilledPostalCode, setPrefilledPostalCode] = useState<string | null>(
    null,
  );
  const [deliveryCheckError, setDeliveryCheckError] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const quantitiesRef = useRef(quantities);
  const handledSelectionHashRef = useRef<string | null>(null);

  useEffect(() => {
    quantitiesRef.current = quantities;
  }, [quantities]);

  useEffect(() => {
    const zip = new URLSearchParams(window.location.search)
      .get("zip")
      ?.replace(/\D/g, "")
      .slice(0, 5);

    if (zip?.length !== 5) return;

    const timeout = window.setTimeout(() => {
      setAddress((current) =>
        current.postalCode === zip ? current : { ...current, postalCode: zip },
      );
      setDeliveryCheck(null);
      setPrefilledPostalCode(zip);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    function selectFromHash() {
      if (!window.location.hash.startsWith("#select-")) return;
      if (handledSelectionHashRef.current === window.location.hash) return;

      const productId = decodeURIComponent(
        window.location.hash.replace("#select-", ""),
      );
      const product = menu.find((item) => item.id === productId);
      if (!product || !canOrderMenuProduct(product)) return;

      handledSelectionHashRef.current = window.location.hash;
      if ((quantitiesRef.current[productId] || 0) > 0) return;

      setQuantities((current) => ({ ...current, [productId]: 1 }));
      trackEvent("add_to_cart", {
        product_id: product.id,
        product_name: product.name,
        quantity_delta: 1,
        source: "direct_select_link",
      });
    }

    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
  }, [menu]);

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
  const selectedItems = cart
    .map((item) => {
      const product = menu.find((entry) => entry.id === item.productId);
      return product ? { ...product, quantity: item.quantity } : null;
    })
    .filter((item): item is MenuProduct & { quantity: number } => Boolean(item));
  const selectedCount = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const selectedDeliveryWindow = deliveryWindows.find(
    (window) => window.id === deliveryWindowId,
  );

  const deliveryFee = deliveryCheck?.eligible ? deliveryCheck.feeCents : 0;
  const total = subtotal + deliveryFee;
  const deliveryFeeLabel = deliveryCheck
    ? deliveryCheck.eligible
      ? formatCurrency(deliveryCheck.feeCents)
      : "Unavailable for this ZIP"
    : "Check ZIP for fee";
  const hasItems = cart.length > 0;
  const hasName = Boolean(customer.name.trim());
  const hasValidContact =
    hasName && isValidEmail(customer.email) && countDigits(customer.phone) >= 7;
  const emailInvalid = Boolean(customer.email) && !isValidEmail(customer.email);
  const phoneInvalid = Boolean(customer.phone) && countDigits(customer.phone) < 7;
  const zipInvalid =
    Boolean(address.postalCode) && !/^\d{5}$/.test(address.postalCode.trim());
  const hasAddress = Boolean(
    address.line1.trim() &&
      address.city.trim() &&
      address.state.trim() &&
      /^\d{5}$/.test(address.postalCode.trim()),
  );
  const hasDeliveryWindow = Boolean(deliveryWindowId);
  const hasEligibleDelivery = Boolean(deliveryCheck?.eligible);
  const checkoutSteps = [
    {
      done: hasItems,
      label: hasItems ? "Items selected" : "Choose at least one item",
    },
    {
      done: hasValidContact,
      label: hasValidContact
        ? "Contact info added"
        : "Add a valid name, email, and phone",
    },
    {
      done: hasAddress,
      label: hasAddress ? "Delivery address added" : "Add delivery address",
    },
    {
      done: hasEligibleDelivery,
      label: hasEligibleDelivery
        ? "Delivery ZIP confirmed"
        : "Check delivery and fee",
    },
    {
      done: hasDeliveryWindow && availableDeliveryWindows.length > 0,
      label: !availableDeliveryWindows.length
        ? "No delivery windows available"
        : hasDeliveryWindow
        ? "Delivery window selected"
        : "Choose a delivery window",
    },
    {
      done: acknowledgedTerms,
      label: acknowledgedTerms
        ? "Ingredients, allergens, and terms reviewed"
        : "Review ingredients, allergens, and terms",
    },
  ];

  function updateQuantity(productId: string, delta: number, max: number) {
    const product = menu.find((item) => item.id === productId);
    setQuantities((current) => {
      const next = Math.max(0, Math.min((current[productId] || 0) + delta, max));
      return { ...current, [productId]: next };
    });
    trackEvent(delta > 0 ? "add_to_cart" : "remove_from_cart", {
      product_id: productId,
      product_name: product?.name,
      quantity_delta: delta,
    });
  }

  function updateAddress<K extends keyof DeliveryAddress>(
    key: K,
    value: DeliveryAddress[K],
  ) {
    setAddress((current) => ({ ...current, [key]: value }));
    if (key === "postalCode" && String(value) !== prefilledPostalCode) {
      setPrefilledPostalCode(null);
    }
    if (key === "state" || key === "postalCode") {
      setDeliveryCheckError(null);
      if (deliveryCheck) {
        setDeliveryCheckNeedsRefresh(true);
      }
      setDeliveryCheck(null);
    }
  }

  function checkDelivery() {
    setMessage(null);
    setDeliveryCheckError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/delivery/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(address),
        });
        const payload = (await response.json().catch(() => null)) as
          | DeliveryCheck
          | null;

        if (!response.ok || !payload) {
          setDeliveryCheck(null);
          setDeliveryCheckNeedsRefresh(false);
          setDeliveryCheckError("Delivery could not be checked. Please try again.");
          trackEvent("check_delivery_error", {
            status: response.status,
            postal_code: address.postalCode,
          });
          return;
        }

        setDeliveryCheck(payload);
        setDeliveryCheckNeedsRefresh(false);
        trackEvent("check_delivery", {
          eligible: payload.eligible,
          postal_code: payload.postalCode || address.postalCode,
          fee_cents: payload.feeCents,
        });
      } catch {
        setDeliveryCheck(null);
        setDeliveryCheckNeedsRefresh(false);
        setDeliveryCheckError("Delivery could not be checked. Please try again.");
        trackEvent("check_delivery_error", {
          status: "network_error",
          postal_code: address.postalCode,
        });
      }
    });
  }

  function submitOrder() {
    setMessage(null);
    trackEvent(afterCutoff ? "availability_request_start" : "checkout_start", {
      item_count: selectedCount,
      subtotal_cents: subtotal,
      delivery_fee_cents: deliveryFee,
      total_cents: total,
    });
    startTransition(async () => {
      let response: Response;
      let payload: CheckoutStartResponse | null = null;
      try {
        response = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cart,
            customer,
            address,
            deliveryWindowId,
            deliveryInstructions,
            notes,
            acknowledgedTerms,
          }),
        });
        payload = (await response.json().catch(() => null)) as
          | CheckoutStartResponse
          | null;
      } catch {
        setMessage("Checkout could not be started. Please try again.");
        trackEvent(afterCutoff ? "availability_request_error" : "checkout_error", {
          item_count: selectedCount,
          status: "network_error",
        });
        return;
      }

      if (!response.ok || !payload?.url) {
        setMessage(
          payload?.error ||
            payload?.message ||
            "Checkout could not be started. Please try again.",
        );
        trackEvent(afterCutoff ? "availability_request_error" : "checkout_error", {
          item_count: selectedCount,
          status: response.status,
        });
        return;
      }

      trackEvent(afterCutoff ? "availability_request_redirect" : "checkout_redirect", {
        item_count: selectedCount,
        total_cents: total,
      });
      window.location.href = payload.url;
    });
  }

  const canSubmitOrderDetails =
    hasItems &&
    hasValidContact &&
    hasAddress &&
    hasDeliveryWindow &&
    availableDeliveryWindows.length > 0 &&
    hasEligibleDelivery &&
    acknowledgedTerms;
  const canCheckout = canSubmitOrderDetails && !afterCutoff;

  return (
    <section
      id="order"
      className={`scroll-mt-32 bg-white py-16 sm:py-20 ${selectedCount ? "pb-32 lg:pb-20" : ""}`}
    >
      <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
            Start your order
          </p>
          <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
            {afterCutoff
              ? "Request this week's sourdough"
              : "Order this week's sourdough"}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-stone-700">
            {afterCutoff
              ? "Choose the items you want, confirm local delivery, and send an availability request."
              : "Pick your favorites, confirm local delivery, and continue to secure checkout while this week's quantities are available."}
          </p>

          <div className="mt-8 grid gap-4">
              {menu.map((item) => {
              const quantity = quantities[item.id] || 0;
              const guidance = getProductGuidance(item);
              return (
                <article
                  key={item.id}
                  id={`select-${item.id}`}
                  className="grid min-w-0 scroll-mt-32 gap-4 rounded-md border border-stone-200 bg-[#fffaf2] p-4 sm:grid-cols-[140px_minmax(0,1fr)_auto]"
                >
                  {item.imageUrl ? (
                    <div className="relative min-h-32 min-w-0 overflow-hidden rounded-md bg-stone-100">
                      <Image
                        src={item.imageUrl}
                        alt={item.name}
                        fill
                        sizes="140px"
                        className="object-cover"
                      />
                      {item.unavailable ? <ProductUnavailableOverlay /> : null}
                    </div>
                  ) : (
                    <div
                      className={`relative min-h-32 overflow-hidden rounded-md bg-gradient-to-br ${item.imageStyle}`}
                    >
                      {item.unavailable ? <ProductUnavailableOverlay /> : null}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={productPath(item)}
                        className="text-lg font-bold text-stone-950 hover:text-[#a94334]"
                      >
                        {item.name}
                      </Link>
                      <span className="rounded-sm bg-white px-2 py-1 text-xs font-semibold uppercase tracking-wide text-stone-600">
                        {item.category === "bread" ? "Bread" : "Add-on"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      {item.description}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      <span className="font-semibold text-stone-900">Best for:</span>{" "}
                      {guidance.bestFor}
                    </p>
                    <p className="mt-3 text-sm text-stone-600">
                      Allergens: {item.allergens.join(", ")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#23443b]">
                      {getMenuProductAvailabilityLabel(item)}
                    </p>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                    <p className="text-lg font-bold text-stone-950">
                      {formatCurrency(item.priceCents)}
                    </p>
                    <div className="flex h-10 items-center overflow-hidden rounded-md border border-stone-300 bg-white">
                      <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        className="flex size-10 items-center justify-center text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-300"
                        disabled={quantity === 0}
                        onClick={() => updateQuantity(item.id, -1, item.remainingQuantity)}
                      >
                        <Minus size={16} />
                      </button>
                      <span className="w-8 text-center text-sm font-bold">{quantity}</span>
                      <button
                        type="button"
                        aria-label={`Add ${item.name}`}
                        className="flex size-10 items-center justify-center text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-300"
                        disabled={!canOrderMenuProduct(item) || quantity >= item.remainingQuantity}
                        onClick={() => updateQuantity(item.id, 1, item.remainingQuantity)}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            {!menu.length ? (
              <div className="rounded-md border border-dashed border-stone-300 bg-[#fffaf2] p-5 text-sm leading-6 text-stone-700">
                Ordering is not open yet. Join the bake alert list and
                we&apos;ll email you when the next menu opens.
              </div>
            ) : null}
          </div>
        </div>

        <aside
          id="checkout-details"
          className="h-fit min-w-0 scroll-mt-32 rounded-md border border-stone-200 bg-[#f7efe3] p-5 shadow-sm lg:sticky lg:top-20"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-stone-950">Checkout details</h3>
              <p className="mt-1 text-sm text-stone-700">
                Confirm your contact info, delivery address, and preferred window.
              </p>
            </div>
            <span className="rounded-sm bg-white px-2 py-1 text-xs font-bold uppercase text-[#a94334]">
              {afterCutoff ? "Requests open" : "Checkout open"}
            </span>
          </div>

          {afterCutoff ? (
            <div className="mt-5 rounded-md border border-[#a94334]/25 bg-white p-4 text-sm leading-6 text-stone-700">
              Online checkout is closed for this bake. Send your requested items
              and delivery details, and we&apos;ll reply with availability.
            </div>
          ) : null}

          <div className="mt-5 grid gap-3">
            <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
              Name
              <input
                className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                name="name"
                autoComplete="name"
                placeholder="Your name"
                required
                value={customer.name}
                onChange={(event) =>
                  setCustomer((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
              Email
              <input
                className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                name="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                type="email"
                required
                aria-invalid={emailInvalid}
                aria-describedby={emailInvalid ? "email-error" : undefined}
                value={customer.email}
                onChange={(event) =>
                  setCustomer((current) => ({ ...current, email: event.target.value }))
                }
              />
              {emailInvalid ? (
                <span id="email-error" className="text-xs font-semibold normal-case tracking-normal text-[#a94334]">
                  Enter a valid email address for order confirmation.
                </span>
              ) : null}
            </label>
            <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
              Phone
              <input
                className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                name="tel"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="Best number for delivery questions"
                minLength={7}
                required
                aria-invalid={phoneInvalid}
                aria-describedby={phoneInvalid ? "phone-error" : undefined}
                value={customer.phone}
                onChange={(event) =>
                  setCustomer((current) => ({ ...current, phone: event.target.value }))
                }
              />
              {phoneInvalid ? (
                <span id="phone-error" className="text-xs font-semibold normal-case tracking-normal text-[#a94334]">
                  Enter at least 7 digits so delivery questions can be resolved.
                </span>
              ) : null}
            </label>
            <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
              Delivery address
              <input
                className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                name="address-line1"
                autoComplete="address-line1"
                placeholder="Street address"
                required
                value={address.line1}
                onChange={(event) =>
                  updateAddress("line1", event.target.value)
                }
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_72px_100px]">
              <label className="grid min-w-0 gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
                City
                <input
                  className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                  name="address-level2"
                  autoComplete="address-level2"
                  placeholder="City"
                  required
                  value={address.city}
                  onChange={(event) =>
                    updateAddress("city", event.target.value)
                  }
                />
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
                State
                <input
                  className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                  name="address-level1"
                  autoComplete="address-level1"
                  placeholder="GA"
                  required
                  value={address.state}
                  onChange={(event) =>
                    updateAddress("state", normalizeStateInput(event.target.value))
                  }
                />
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
                ZIP
                <input
                  className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                  name="postal-code"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  required
                  placeholder="30114"
                  aria-invalid={zipInvalid}
                  aria-describedby={zipInvalid ? "zip-error" : undefined}
                  value={address.postalCode}
                  onChange={(event) =>
                    updateAddress(
                      "postalCode",
                      event.target.value.replace(/\D/g, "").slice(0, 5),
                    )
                  }
                />
                {zipInvalid ? (
                  <span id="zip-error" className="text-xs font-semibold normal-case tracking-normal text-[#a94334]">
                    Enter a 5-digit ZIP code to check delivery.
                  </span>
                ) : null}
              </label>
            </div>
            {prefilledPostalCode && !deliveryCheck ? (
              <div
                className="flex gap-2 rounded-md bg-white p-3 text-sm text-stone-700"
                role="status"
                aria-live="polite"
              >
                <CheckCircle2 className="mt-0.5 text-[#23443b]" size={18} />
                <p>
                  ZIP {prefilledPostalCode} is prefilled. Add the street
                  address, then check delivery and fee before checkout.
                </p>
              </div>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={checkDelivery}
              disabled={!hasAddress || isPending}
            >
              {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
              {hasAddress
                ? deliveryCheckNeedsRefresh
                  ? "Recheck delivery and fee"
                  : "Check delivery and fee"
                : "Add address to check delivery"}
            </Button>
            {deliveryCheckNeedsRefresh && hasAddress ? (
              <div
                className="flex gap-2 rounded-md bg-white p-3 text-sm text-stone-700"
                role="status"
                aria-live="polite"
              >
                <AlertCircle className="mt-0.5 text-[#a94334]" size={18} />
                <p>
                  Delivery details changed. Recheck delivery and fee before
                  checkout.
                </p>
              </div>
            ) : null}
            {deliveryCheckError ? (
              <div
                className="flex gap-2 rounded-md bg-white p-3 text-sm text-stone-700"
                role="alert"
              >
                <AlertCircle className="mt-0.5 text-[#a94334]" size={18} />
                <p>{deliveryCheckError}</p>
              </div>
            ) : null}
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

            <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
              Delivery window
              <select
                className="h-11 rounded-md border border-stone-300 px-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                value={deliveryWindowId}
                onChange={(event) => setDeliveryWindowId(event.target.value)}
                disabled={!availableDeliveryWindows.length}
              >
                {!availableDeliveryWindows.length ? (
                  <option value="">No delivery windows available</option>
                ) : null}
                {deliveryWindows.map((window) => (
                  <option
                    key={window.id}
                    value={window.id}
                    disabled={window.reserved >= window.capacity}
                  >
                    {window.label}{" "}
                    {window.reserved >= window.capacity
                      ? "(full)"
                      : `(${window.capacity - window.reserved} spots)`}
                  </option>
                ))}
              </select>
            </label>
            {!availableDeliveryWindows.length ? (
              <div className="rounded-md bg-white p-3 text-sm leading-6 text-stone-700">
                Delivery windows are currently full. Join the bake alert list or
                use the question box for timing questions before the next menu.
              </div>
            ) : null}
            <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
              Delivery instructions
              <textarea
                className="min-h-20 min-w-0 rounded-md border border-stone-300 p-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                name="delivery-instructions"
                autoComplete="off"
                placeholder="Gate code, porch notes, or best drop-off spot"
                value={deliveryInstructions}
                onChange={(event) => setDeliveryInstructions(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-stone-600">
              Order notes
              <textarea
                className="min-h-24 min-w-0 rounded-md border border-stone-300 p-3 text-sm font-normal normal-case tracking-normal text-stone-950"
                name="order-notes"
                autoComplete="off"
                placeholder="Anything we should know about this order"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </div>

          {selectedItems.length ? (
            <div className="mt-5 rounded-md bg-white p-3 text-sm text-stone-700">
              <p className="font-bold text-stone-950">
                Your items ({selectedCount})
              </p>
              <div className="mt-2 grid gap-1">
                {selectedItems.map((item) => (
                  <div key={item.id} className="flex justify-between gap-3">
                    <span>
                      {item.quantity} x {item.name}
                    </span>
                    <span>{formatCurrency(item.priceCents * item.quantity)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div
            className="mt-5 rounded-md border border-stone-200 bg-white p-3"
            aria-live="polite"
          >
            <p className="text-sm font-bold text-stone-950">
              {canSubmitOrderDetails
                ? afterCutoff
                  ? "Ready to send request"
                  : "Ready for checkout"
                : "To finish"}
            </p>
            <div className="mt-2 grid gap-2 text-sm text-stone-700">
              {checkoutSteps.map((step) => (
                <div key={step.label} className="flex items-center gap-2">
                  {step.done ? (
                    <CheckCircle2 className="shrink-0 text-[#23443b]" size={16} />
                  ) : (
                    <AlertCircle className="shrink-0 text-[#a94334]" size={16} />
                  )}
                  <span className={step.done ? "text-stone-600" : "font-semibold text-stone-900"}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-2 border-t border-stone-300 pt-4 text-sm text-stone-700">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Delivery</span>
              <span>{deliveryFeeLabel}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-stone-950">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          <div className="mt-5 rounded-md border border-stone-200 bg-white p-3 text-sm leading-6 text-stone-700">
            <p className="font-bold text-stone-950">What happens next</p>
            <ul className="mt-2 grid gap-2">
              <li className="flex gap-2">
                <CheckCircle2 className="mt-1 shrink-0 text-[#23443b]" size={16} />
                <span>
                  {afterCutoff
                    ? "No payment is collected for availability requests."
                    : "Payment opens in Stripe Checkout after you continue."}
                </span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-1 shrink-0 text-[#23443b]" size={16} />
                <span>
                  {selectedDeliveryWindow
                    ? `Your selected delivery window is ${selectedDeliveryWindow.label}.`
                    : "Choose a delivery window before checkout so timing is clear."}
                </span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-1 shrink-0 text-[#23443b]" size={16} />
                <span>
                  {afterCutoff
                    ? "We will reply by email before anything is confirmed."
                    : "After payment, your confirmation is sent by email."}
                </span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-1 shrink-0 text-[#23443b]" size={16} />
                <span>
                  Review{" "}
                  <Link
                    href="/policies/refunds-cancellations"
                    className="font-bold text-[#23443b] underline"
                  >
                    refund and cancellation details
                  </Link>
                  .
                </span>
              </li>
            </ul>
          </div>

          <label className="mt-4 flex items-start gap-3 rounded-md border border-stone-200 bg-white p-3 text-sm leading-6 text-stone-700">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-[#23443b]"
              checked={acknowledgedTerms}
              onChange={(event) => setAcknowledgedTerms(event.target.checked)}
              required
            />
            <span>
              I confirm the delivery details are correct and I have reviewed the
              listed ingredients, allergens,{" "}
              <Link
                href="/policies/allergen-cottage-food"
                className="font-bold text-[#23443b] underline"
              >
                cottage-food notice
              </Link>
              , and{" "}
              <Link
                href="/policies/terms"
                className="font-bold text-[#23443b] underline"
              >
                order terms
              </Link>
              .
            </span>
          </label>

          <Button
            type="button"
            className="mt-5 w-full"
            variant={afterCutoff ? "secondary" : "primary"}
            disabled={afterCutoff ? !canSubmitOrderDetails || isPending : !canCheckout || isPending}
            onClick={submitOrder}
          >
            {isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
            {afterCutoff ? "Send availability request" : "Continue to secure checkout"}
          </Button>
          {message ? (
            <p className="mt-3 text-sm text-[#a94334]" role="status" aria-live="polite">
              {message}
            </p>
          ) : null}
        </aside>
      </div>
      {selectedCount ? (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-[0_-8px_20px_rgba(28,25,23,0.12)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-md items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-stone-950">
                {selectedCount} {selectedCount === 1 ? "item" : "items"} selected
              </p>
              <p className="text-xs font-semibold text-stone-600">
                Subtotal {formatCurrency(subtotal)}
              </p>
            </div>
            <a
              href="#checkout-details"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-[#23443b] px-4 text-sm font-bold text-white"
            >
              <ShoppingBag size={16} />
              Review order
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
