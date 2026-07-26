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
} from "lucide-react";
import { useMemo, useState, useTransition, type FormEvent } from "react";
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

function productIdsAvailableForAllWeeks(
  plan: BreadClubPlan,
  data: BreadClubEnrollmentData,
) {
  return new Set(
    plan.eligibleProducts
      .filter((product) =>
        data.weeks.every((week) => {
          const menuItem = week.menu.find((item) => item.id === product.id);
          return Boolean(
            menuItem &&
              menuItem.active &&
              !menuItem.unavailable &&
              menuItem.remainingQuantity >= 1,
          );
        }),
      )
      .map((product) => product.id),
  );
}

function defaultSelection(
  plan: BreadClubPlan,
  data: BreadClubEnrollmentData,
): BreadClubSelection[] {
  const availableIds = productIdsAvailableForAllWeeks(plan, data);
  const guaranteed = plan.eligibleProducts.find(
    (product) => product.guaranteed && availableIds.has(product.id),
  );
  const first =
    guaranteed ||
    plan.eligibleProducts.find((product) => availableIds.has(product.id));
  return first
    ? [{ productId: first.id, quantity: plan.loavesPerWeek }]
    : [];
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
}: {
  data: BreadClubEnrollmentData;
  automaticTaxEnabled: boolean;
}) {
  const initialPlan = data.plans[1] || data.plans[0];
  const [planId, setPlanId] = useState(initialPlan?.id || "");
  const [selection, setSelection] = useState<BreadClubSelection[]>(
    initialPlan ? defaultSelection(initialPlan, data) : [],
  );
  const [customer, setCustomer] = useState({
    name: "",
    email: "",
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

  const plan =
    data.plans.find((item) => item.id === planId) || initialPlan;
  const availableIds = useMemo(
    () =>
      plan ? productIdsAvailableForAllWeeks(plan, data) : new Set<string>(),
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

    startCheckoutTransition(async () => {
      try {
        const response = await fetch("/api/bread-club/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: plan.id,
            selection,
            customer,
            address,
            deliveryInstructions,
            acknowledgedAutoRenewal: true,
            consentText,
          }),
        });
        const payload = (await response.json()) as {
          url?: string;
          error?: string;
        };
        if (!response.ok || !payload.url) {
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
    <form onSubmit={beginCheckout} className="space-y-12">
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
          {plan.eligibleProducts.map((product) => {
            const quantity =
              selection.find((item) => item.productId === product.id)
                ?.quantity || 0;
            const available = availableIds.has(product.id);
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
                    {!available ? (
                      <span className="rounded-sm bg-stone-200 px-2 py-1 text-xs font-bold text-stone-600">
                        Not available all four weeks
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-stone-700">
                    {product.description}
                  </p>
                </div>
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
                    disabled={
                      !available || selectedQuantity >= plan.loavesPerWeek
                    }
                    onClick={() => changeProductQuantity(product.id, 1)}
                    className="flex size-10 items-center justify-center border border-stone-300 bg-white text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            );
          })}
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

      <section aria-labelledby="delivery-heading">
        <p className="text-sm font-bold uppercase text-[#a94334]">
          4. Confirm customer and delivery details
        </p>
        <h2 id="delivery-heading" className="mt-2 text-2xl font-bold text-stone-950">
          Check the address before payment
        </h2>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
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
                className="mt-2 h-11 w-full border border-stone-300 px-3 font-normal"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-bold text-stone-800">
                Email
                <input
                  name="bread-club-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={customer.email}
                  onChange={(event) =>
                    setCustomer((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  className="mt-2 h-11 w-full min-w-0 border border-stone-300 px-3 font-normal"
                />
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
                  className="mt-2 h-11 w-full min-w-0 border border-stone-300 px-3 font-normal"
                />
              </label>
            </div>
          </div>

          <div className="space-y-4">
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
                className="mt-2 h-11 w-full border border-stone-300 px-3 font-normal"
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
                className="mt-2 h-11 w-full border border-stone-300 px-3 font-normal"
              />
            </label>
            <div className="grid grid-cols-[1fr_76px_100px] gap-3">
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
                  className="mt-2 h-11 w-full min-w-0 border border-stone-300 px-3 font-normal"
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
                  className="mt-2 h-11 w-full min-w-0 border border-stone-300 px-3 font-normal"
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
                  className="mt-2 h-11 w-full min-w-0 border border-stone-300 px-3 font-normal"
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
                className="mt-2 w-full border border-stone-300 p-3 font-normal"
                placeholder="Gate, porch, or drop-off details"
              />
            </label>
            <Button
              type="button"
              onClick={checkDelivery}
              disabled={
                isChecking ||
                !address.line1 ||
                !address.city ||
                address.postalCode.length !== 5
              }
            >
              {isChecking ? (
                <Loader2 className="animate-spin" size={17} />
              ) : (
                <MapPin size={17} />
              )}
              {isChecking ? "Checking drive time..." : "Check delivery and total"}
            </Button>
          </div>
        </div>

        {deliveryResult?.eligible && deliveryPrice ? (
          <div
            className="mt-5 flex gap-3 border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"
            role="status"
          >
            <CheckCircle2 className="mt-0.5 shrink-0" size={19} />
            <p>
              {deliveryResult.message} Four-week delivery total:{" "}
              <strong>{formatCurrency(deliveryPrice.priceCents)}</strong>.
            </p>
          </div>
        ) : null}
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
