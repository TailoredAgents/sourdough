"use client";

import {
  CalendarDays,
  Check,
  CheckCircle2,
  Loader2,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  Truck,
  UserRound,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import type {
  BreadClubEnrollmentData,
  BreadClubPlan,
  BreadClubSelection,
} from "@/lib/bread-club/types";
import { BREAD_CLUB_PLAN_COPY } from "@/lib/bread-club/config";
import {
  buildBreadClubConsentText,
  findBreadClubDeliveryPrice,
  getBreadClubCycleTotalCents,
} from "@/lib/bread-club/pricing";
import {
  getDefaultBreadClubSelection,
  getProductsAvailableForAllWeeks,
} from "@/lib/bread-club/schedule";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";

type DeliveryResult = {
  eligible: boolean;
  preliminary: boolean;
  message: string;
  feeCents: number;
  durationMinutes?: number;
  pricingBand?: string;
};

type Address = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
};

function defaultSelection(
  plan: BreadClubPlan,
  data: BreadClubEnrollmentData,
): BreadClubSelection[] {
  return getDefaultBreadClubSelection(plan, data.weeks);
}

function formatSundayDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(date));
}

export function BreadClubEnrollment({
  data,
  automaticTaxEnabled,
  previewEmail,
}: {
  data: BreadClubEnrollmentData;
  automaticTaxEnabled: boolean;
  previewEmail?: string | null;
}) {
  const initialPlan = data.plans[1] || data.plans[0];
  const [planId, setPlanId] = useState(initialPlan?.id || "");
  const [selection, setSelection] = useState<BreadClubSelection[]>(
    initialPlan ? defaultSelection(initialPlan, data) : [],
  );
  const [customer, setCustomer] = useState({
    name: "",
    email: previewEmail || "",
    phone: "",
  });
  const [address, setAddress] = useState<Address>({
    line1: "",
    line2: "",
    city: "Canton",
    state: "GA",
    postalCode: "",
  });
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [deliveryResult, setDeliveryResult] =
    useState<DeliveryResult | null>(null);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, startDeliveryTransition] = useTransition();
  const [isCheckingOut, startCheckoutTransition] = useTransition();
  const checkoutAttemptRef = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);

  const plan =
    data.plans.find((item) => item.id === planId) || initialPlan;
  const availableProducts = useMemo(
    () => (plan ? getProductsAvailableForAllWeeks(plan, data.weeks) : []),
    [data, plan],
  );
  const selectedQuantity = selection.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const deliveryPrice =
    deliveryResult?.eligible && plan
      ? findBreadClubDeliveryPrice(
          data.deliveryPrices,
          deliveryResult.durationMinutes,
          deliveryResult.feeCents,
        )
      : null;
  const totalCents =
    plan && deliveryPrice
      ? getBreadClubCycleTotalCents(
          plan.priceCents,
          deliveryPrice.priceCents,
        )
      : null;
  const consentText =
    totalCents === null
      ? ""
      : buildBreadClubConsentText(totalCents, automaticTaxEnabled);

  function choosePlan(nextPlan: BreadClubPlan) {
    setPlanId(nextPlan.id);
    setSelection(defaultSelection(nextPlan, data));
    setConsented(false);
    setError(null);
  }

  function changeProductQuantity(productId: string, amount: number) {
    if (!plan) return;
    setSelection((current) => {
      const quantities = new Map(
        current.map((item) => [item.productId, item.quantity]),
      );
      const currentQuantity = quantities.get(productId) || 0;
      const currentTotal = Array.from(quantities.values()).reduce(
        (sum, quantity) => sum + quantity,
        0,
      );
      const nextQuantity = Math.max(currentQuantity + amount, 0);
      if (
        amount > 0 &&
        currentTotal >= plan.loavesPerWeek
      ) {
        return current;
      }
      if (nextQuantity === 0) quantities.delete(productId);
      else quantities.set(productId, nextQuantity);
      return Array.from(quantities, ([id, quantity]) => ({
        productId: id,
        quantity,
      }));
    });
    setConsented(false);
  }

  function chooseSingleProduct(productId: string) {
    setSelection([{ productId, quantity: 1 }]);
    setConsented(false);
    setError(null);
  }

  function updateAddress(field: keyof Address, value: string) {
    setAddress((current) => ({
      ...current,
      [field]:
        field === "postalCode"
          ? value.replace(/\D/g, "").slice(0, 5)
          : value,
    }));
    setDeliveryResult(null);
    setConsented(false);
  }

  function checkDelivery() {
    setError(null);
    setDeliveryResult(null);
    setConsented(false);
    startDeliveryTransition(async () => {
      try {
        const response = await fetch("/api/delivery/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(address),
        });
        const payload = (await response.json()) as DeliveryResult;
        if (!response.ok || !payload.eligible || payload.preliminary) {
          setError(
            payload.message ||
              "This address could not be confirmed for delivery.",
          );
          return;
        }
        setDeliveryResult(payload);
      } catch {
        setError("Delivery could not be checked. Please try again.");
      }
    });
  }

  function beginCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!plan || selectedQuantity !== plan.loavesPerWeek) {
      setError(
        `Choose ${plan?.loavesPerWeek || 1} loaf${
          plan?.loavesPerWeek === 1 ? "" : "s"
        } for each Sunday.`,
      );
      return;
    }
    if (!deliveryResult?.eligible || !deliveryPrice || totalCents === null) {
      setError("Check your full delivery address before checkout.");
      return;
    }
    if (!consented) {
      setError("Confirm the four-week auto-renewal terms before checkout.");
      return;
    }

    const checkoutDetails = {
      planId: plan.id,
      selection,
      customer,
      address,
      deliveryInstructions,
      acknowledgedAutoRenewal: true as const,
      consentText,
    };
    const checkoutFingerprint = JSON.stringify(checkoutDetails);
    if (checkoutAttemptRef.current?.fingerprint !== checkoutFingerprint) {
      checkoutAttemptRef.current = {
        fingerprint: checkoutFingerprint,
        id: crypto.randomUUID(),
      };
    }
    const checkoutAttemptId = checkoutAttemptRef.current.id;

    startCheckoutTransition(async () => {
      try {
        const response = await fetch("/api/bread-club/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...checkoutDetails,
            checkoutAttemptId,
          }),
        });
        const payload = (await response.json()) as {
          url?: string;
          error?: string;
          resetCheckoutAttempt?: boolean;
        };
        if (!response.ok || !payload.url) {
          if (payload.resetCheckoutAttempt) {
            checkoutAttemptRef.current = null;
          }
          setError(payload.error || "Bread Club checkout could not start.");
          return;
        }
        window.location.assign(payload.url);
      } catch {
        setError("Bread Club checkout could not start. Please try again.");
      }
    });
  }

  if (!plan || data.weeks.length !== 4) {
    return (
      <div className="border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        Four Sunday menus are not ready for enrollment. No payment can be
        started until all four deliveries are available.
      </div>
    );
  }

  return (
    <form
      id="bread-club-enrollment"
      onSubmit={beginCheckout}
      className="scroll-mt-28 space-y-12"
    >
      {previewEmail ? (
        <div
          className="border border-[#23443b]/25 bg-[#edf4f0] p-4 text-sm leading-6 text-[#18352e]"
          role="status"
        >
          Owner checkout test is active. Checkout and membership emails will
          use <strong>{previewEmail}</strong>. Public enrollment remains closed.
        </div>
      ) : null}

      <section aria-labelledby="plan-heading">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase text-[#a94334]">
              1. Choose your plan
            </p>
            <h2 id="plan-heading" className="mt-2 text-2xl font-bold text-stone-950">
              Four Sundays, one simple renewal
            </h2>
          </div>
          <p className="max-w-lg text-sm leading-6 text-stone-700">
            Delivery is priced after your full address is checked. Variety is
            the easiest plan for changing flavors week to week.
          </p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {data.plans.map((item) => {
            const copy = BREAD_CLUB_PLAN_COPY[item.slug];
            const selected = item.id === plan.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => choosePlan(item)}
                className={`relative min-h-[270px] border p-5 text-left transition ${
                  selected
                    ? "border-[#23443b] bg-[#f2f7f4] shadow-sm"
                    : "border-stone-200 bg-white hover:border-stone-400"
                }`}
              >
                {copy.badge ? (
                  <span className="inline-flex rounded-sm bg-[#a94334] px-2 py-1 text-xs font-bold text-white">
                    {copy.badge}
                  </span>
                ) : null}
                <div className="mt-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold text-stone-950">
                      {item.name}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      {copy.shortDescription}
                    </p>
                  </div>
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? "border-[#23443b] bg-[#23443b] text-white"
                        : "border-stone-300 text-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    <Check size={16} />
                  </span>
                </div>
                <p className="mt-5 text-2xl font-bold text-stone-950">
                  {formatCurrency(item.priceCents)}
                  <span className="ml-1 text-sm font-medium text-stone-600">
                    / 4 weeks
                  </span>
                </p>
                <p className="mt-1 text-sm font-semibold text-[#a94334]">
                  From {formatCurrency(copy.fromDeliveredCents)} delivered
                </p>
                <ul className="mt-5 space-y-2 text-sm text-stone-700">
                  {copy.included.map((line) => (
                    <li key={line} className="flex gap-2">
                      <CheckCircle2
                        size={16}
                        className="mt-0.5 shrink-0 text-[#23443b]"
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="loaf-heading">
        <p className="text-sm font-bold uppercase text-[#a94334]">
          2. Choose your default loaf
        </p>
        <div className="mt-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <h2 id="loaf-heading" className="text-2xl font-bold text-stone-950">
            Your starting selection
          </h2>
          <p className="text-sm font-semibold text-stone-700">
            {selectedQuantity} of {plan.loavesPerWeek} selected
          </p>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700">
          This default is reserved for all four Sundays. You can switch an
          individual week to another available eligible bread before Thursday
          at 11:59 PM.
        </p>

        <div className="mt-6 divide-y divide-stone-200 border border-stone-200 bg-white">
          {availableProducts.map((product) => {
            const quantity =
              selection.find((item) => item.productId === product.id)
                ?.quantity || 0;
            return (
              <div
                key={product.id}
                className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-stone-950">{product.name}</h3>
                    {product.guaranteed ? (
                      <span className="rounded-sm bg-[#edf4f0] px-2 py-1 text-xs font-bold text-[#23443b]">
                        Guaranteed
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-stone-700">
                    {product.description}
                  </p>
                </div>
                {plan.loavesPerWeek === 1 ? (
                  <label
                    className={`inline-flex h-10 cursor-pointer items-center gap-2 border px-3 text-sm font-bold ${
                      quantity === 1
                        ? "border-[#23443b] bg-[#edf4f0] text-[#18352e]"
                        : "border-stone-300 bg-white text-stone-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`bread-club-${plan.slug}-default`}
                      value={product.id}
                      checked={quantity === 1}
                      onChange={() => chooseSingleProduct(product.id)}
                      className="size-4 accent-[#23443b]"
                    />
                    {quantity === 1 ? "Selected" : "Choose"}
                  </label>
                ) : (
                  <div className="grid grid-cols-[40px_44px_40px] items-center">
                    <button
                      type="button"
                      title={`Remove ${product.name}`}
                      aria-label={`Remove ${product.name}`}
                      disabled={quantity === 0}
                      onClick={() => changeProductQuantity(product.id, -1)}
                      className="flex size-10 items-center justify-center border border-stone-300 bg-white text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Minus size={16} />
                    </button>
                    <output
                      aria-label={`${product.name} quantity`}
                      className="flex h-10 items-center justify-center border-y border-stone-300 font-bold"
                    >
                      {quantity}
                    </output>
                    <button
                      type="button"
                      title={`Add ${product.name}`}
                      aria-label={`Add ${product.name}`}
                      disabled={selectedQuantity >= plan.loavesPerWeek}
                      onClick={() => changeProductQuantity(product.id, 1)}
                      className="flex size-10 items-center justify-center border border-stone-300 bg-white text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {availableProducts.length === 0 ? (
            <div className="p-5 text-sm leading-6 text-amber-950">
              No eligible loaves are available across all four Sundays for this
              plan. Choose another plan or check back after the weekly menus are
              updated.
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="sundays-heading">
        <p className="text-sm font-bold uppercase text-[#a94334]">
          3. Review your Sundays
        </p>
        <h2 id="sundays-heading" className="mt-2 text-2xl font-bold text-stone-950">
          Your first four delivery dates
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.weeks.map((week, index) => (
            <div
              key={week.weeklyMenu.id}
              className="border border-stone-200 bg-[#fffaf2] p-4"
            >
              <CalendarDays size={19} className="text-[#a94334]" />
              <p className="mt-3 text-xs font-bold uppercase text-stone-500">
                Delivery {index + 1}
              </p>
              <p className="mt-1 font-bold text-stone-950">
                {formatSundayDate(week.deliveryWindow.startsAt)}
              </p>
              <p className="mt-1 text-sm text-stone-700">3:00-6:00 PM</p>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="delivery-heading"
        className="overflow-hidden border-2 border-[#23443b] bg-white shadow-[0_12px_30px_rgba(35,68,59,0.12)]"
      >
        <div className="flex flex-col justify-between gap-4 bg-[#23443b] px-5 py-5 text-white sm:flex-row sm:items-end sm:px-7 sm:py-6">
          <div>
            <p className="text-sm font-bold uppercase text-[#f5c28b]">
              4. Join Bread Club
            </p>
            <h2 id="delivery-heading" className="mt-2 text-3xl font-bold">
              Enter your information
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-100">
              Your contact details create the membership account. Your full
              address confirms delivery availability and the exact recurring
              total.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 self-start border border-white/30 bg-white/10 px-3 py-2 text-sm font-bold sm:self-auto">
            <ShieldCheck size={17} />
            Secure enrollment
          </span>
        </div>

        <div className="p-5 sm:p-7">
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-0">
            <div className="lg:pr-8">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center bg-[#edf4f0] text-[#23443b]">
                  <UserRound size={19} />
                </span>
                <div>
                  <h3 className="font-bold text-stone-950">Contact details</h3>
                  <p className="mt-1 text-sm text-stone-600">
                    Used for receipts and secure membership access.
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-4">
                <label className="block text-sm font-bold text-stone-800">
                  Full name
                  <input
                    name="bread-club-name"
                    autoComplete="name"
                    required
                    value={customer.name}
                    onChange={(event) =>
                      setCustomer((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className="mt-2 h-12 w-full border border-stone-400 bg-[#fffdf8] px-3 font-normal outline-none transition focus:border-[#23443b] focus:ring-2 focus:ring-[#23443b]/20"
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-bold text-stone-800">
                    Email
                    <input
                      name="bread-club-email"
                      type="email"
                      autoComplete={previewEmail ? "off" : "email"}
                      required
                      value={customer.email}
                      readOnly={Boolean(previewEmail)}
                      aria-describedby={
                        previewEmail
                          ? "bread-club-preview-email-note"
                          : undefined
                      }
                      onChange={(event) =>
                        setCustomer((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      className="mt-2 h-12 w-full min-w-0 border border-stone-400 bg-[#fffdf8] px-3 font-normal outline-none transition focus:border-[#23443b] focus:ring-2 focus:ring-[#23443b]/20 read-only:bg-stone-100 read-only:text-stone-600"
                    />
                    {previewEmail ? (
                      <span
                        id="bread-club-preview-email-note"
                        className="mt-1 block text-xs font-normal leading-5 text-stone-600"
                      >
                        Locked to the signed-in owner for this checkout test.
                      </span>
                    ) : null}
                  </label>
                  <label className="block text-sm font-bold text-stone-800">
                    Phone
                    <input
                      name="bread-club-phone"
                      type="tel"
                      autoComplete="tel"
                      required
                      value={customer.phone}
                      onChange={(event) =>
                        setCustomer((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                      className="mt-2 h-12 w-full min-w-0 border border-stone-400 bg-[#fffdf8] px-3 font-normal outline-none transition focus:border-[#23443b] focus:ring-2 focus:ring-[#23443b]/20"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="border-t border-stone-200 pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center bg-[#fff0e4] text-[#a94334]">
                  <Truck size={19} />
                </span>
                <div>
                  <h3 className="font-bold text-stone-950">Sunday delivery</h3>
                  <p className="mt-1 text-sm text-stone-600">
                    Confirm your address before continuing to payment.
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-4">
                <label className="block text-sm font-bold text-stone-800">
                  Street address
                  <input
                    name="bread-club-address-line1"
                    autoComplete="address-line1"
                    required
                    value={address.line1}
                    onChange={(event) =>
                      updateAddress("line1", event.target.value)
                    }
                    className="mt-2 h-12 w-full border border-stone-400 bg-[#fffdf8] px-3 font-normal outline-none transition focus:border-[#23443b] focus:ring-2 focus:ring-[#23443b]/20"
                  />
                </label>
                <label className="block text-sm font-bold text-stone-800">
                  Apartment or unit
                  <input
                    name="bread-club-address-line2"
                    autoComplete="address-line2"
                    value={address.line2}
                    onChange={(event) =>
                      updateAddress("line2", event.target.value)
                    }
                    className="mt-2 h-12 w-full border border-stone-400 bg-[#fffdf8] px-3 font-normal outline-none transition focus:border-[#23443b] focus:ring-2 focus:ring-[#23443b]/20"
                  />
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_70px_92px] gap-2 sm:grid-cols-[1fr_76px_100px] sm:gap-3">
                  <label className="min-w-0 text-sm font-bold text-stone-800">
                    City
                    <input
                      name="bread-club-city"
                      autoComplete="address-level2"
                      required
                      value={address.city}
                      onChange={(event) =>
                        updateAddress("city", event.target.value)
                      }
                      className="mt-2 h-12 w-full min-w-0 border border-stone-400 bg-[#fffdf8] px-3 font-normal outline-none transition focus:border-[#23443b] focus:ring-2 focus:ring-[#23443b]/20"
                    />
                  </label>
                  <label className="min-w-0 text-sm font-bold text-stone-800">
                    State
                    <input
                      name="bread-club-state"
                      autoComplete="address-level1"
                      required
                      value={address.state}
                      onChange={(event) =>
                        updateAddress("state", event.target.value)
                      }
                      className="mt-2 h-12 w-full min-w-0 border border-stone-400 bg-[#fffdf8] px-2 font-normal outline-none transition focus:border-[#23443b] focus:ring-2 focus:ring-[#23443b]/20"
                    />
                  </label>
                  <label className="min-w-0 text-sm font-bold text-stone-800">
                    ZIP
                    <input
                      name="bread-club-postal-code"
                      autoComplete="postal-code"
                      inputMode="numeric"
                      required
                      value={address.postalCode}
                      onChange={(event) =>
                        updateAddress("postalCode", event.target.value)
                      }
                      className="mt-2 h-12 w-full min-w-0 border border-stone-400 bg-[#fffdf8] px-2 font-normal outline-none transition focus:border-[#23443b] focus:ring-2 focus:ring-[#23443b]/20"
                    />
                  </label>
                </div>
                <label className="block text-sm font-bold text-stone-800">
                  Delivery notes
                  <textarea
                    name="bread-club-delivery-instructions"
                    value={deliveryInstructions}
                    onChange={(event) =>
                      setDeliveryInstructions(event.target.value)
                    }
                    rows={3}
                    className="mt-2 w-full border border-stone-400 bg-[#fffdf8] p-3 font-normal outline-none transition focus:border-[#23443b] focus:ring-2 focus:ring-[#23443b]/20"
                    placeholder="Gate, porch, or drop-off details"
                  />
                </label>
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={checkDelivery}
                  disabled={
                    isChecking ||
                    !address.line1 ||
                    !address.city ||
                    address.postalCode.length !== 5
                  }
                >
                  {isChecking ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <MapPin size={18} />
                  )}
                  {isChecking
                    ? "Checking drive time..."
                    : "Check delivery and show my total"}
                </Button>
              </div>
            </div>
          </div>

          {deliveryResult?.eligible && deliveryPrice ? (
            <div
              className="mt-6 flex gap-3 border border-emerald-300 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"
              role="status"
            >
              <CheckCircle2 className="mt-0.5 shrink-0" size={19} />
              <p>
                {deliveryResult.message} Four-week delivery total:{" "}
                <strong>{formatCurrency(deliveryPrice.priceCents)}</strong>.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="total-heading" className="border-t border-stone-300 pt-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.8fr]">
          <div>
            <p className="text-sm font-bold uppercase text-[#a94334]">
              5. Confirm renewal and pay
            </p>
            <h2 id="total-heading" className="mt-2 text-2xl font-bold text-stone-950">
              Exact four-week total
            </h2>
            <div className="mt-5 divide-y divide-stone-200 border border-stone-200 bg-white">
              <div className="flex justify-between gap-4 p-4 text-sm">
                <span>{plan.name}</span>
                <strong>{formatCurrency(plan.priceCents)}</strong>
              </div>
              <div className="flex justify-between gap-4 p-4 text-sm">
                <span>Four Sunday deliveries</span>
                <strong>
                  {deliveryPrice
                    ? formatCurrency(deliveryPrice.priceCents)
                    : "Check address"}
                </strong>
              </div>
              <div className="flex justify-between gap-4 p-4 text-lg">
                <span className="font-bold">Due every four weeks</span>
                <strong>
                  {totalCents === null
                    ? "Pending address"
                    : formatCurrency(totalCents)}
                </strong>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              {automaticTaxEnabled
                ? "Applicable tax is calculated and shown by Stripe before payment."
                : "No additional tax is currently added. Any future tax treatment change will be disclosed before it applies."}
            </p>
          </div>

          <div>
            <div className="border border-stone-300 bg-[#fffaf2] p-5">
              <div className="flex gap-3">
                <ShieldCheck className="shrink-0 text-[#23443b]" size={22} />
                <div>
                  <h3 className="font-bold text-stone-950">
                    Auto-renewal authorization
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-stone-700">
                    Membership includes one skip per four-week cycle. Cancel
                    online at any time; cancellation stops the next renewal and
                    keeps already-paid deliveries.
                  </p>
                </div>
              </div>
              <label className="mt-5 flex cursor-pointer items-start gap-3 border-t border-stone-200 pt-5 text-sm leading-6 text-stone-800">
                <input
                  type="checkbox"
                  name="bread-club-auto-renewal-consent"
                  checked={consented}
                  disabled={totalCents === null}
                  onChange={(event) => setConsented(event.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-[#23443b]"
                />
                <span>{consentText || "Check your address to see and authorize the exact renewal amount."}</span>
              </label>
              <Button
                type="submit"
                size="lg"
                className="mt-5 w-full"
                disabled={
                  isCheckingOut ||
                  !consented ||
                  totalCents === null ||
                  selectedQuantity !== plan.loavesPerWeek
                }
              >
                {isCheckingOut ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <ShieldCheck size={18} />
                )}
                {isCheckingOut
                  ? "Opening secure checkout..."
                  : "Continue to secure payment"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div
          className="border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900"
          role="alert"
        >
          {error}
        </div>
      ) : null}
    </form>
  );
}
