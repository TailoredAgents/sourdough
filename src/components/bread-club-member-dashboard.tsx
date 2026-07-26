"use client";

import {
  CalendarCheck2,
  CalendarX2,
  CheckCircle2,
  CreditCard,
  Loader2,
  LogOut,
  MapPin,
  PackagePlus,
  RefreshCw,
  Save,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import type {
  BreadClubMemberData,
  BreadClubMemberFulfillment,
  BreadClubPlan,
  BreadClubSelection,
} from "@/lib/bread-club/types";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";

function formatDate(value: string, withTime = false) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function selectionSlots(
  selection: BreadClubSelection[],
  count: number,
) {
  const slots: string[] = [];
  for (const item of selection) {
    for (let index = 0; index < item.quantity; index += 1) {
      slots.push(item.productId);
    }
  }
  while (slots.length < count) slots.push("");
  return slots.slice(0, count);
}

function groupedSelection(productIds: string[]) {
  const quantities = new Map<string, number>();
  for (const productId of productIds.filter(Boolean)) {
    quantities.set(productId, (quantities.get(productId) || 0) + 1);
  }
  return Array.from(quantities, ([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

function SundaySelectionEditor({
  fulfillment,
  loavesPerWeek,
  disabled,
  onSave,
}: {
  fulfillment: BreadClubMemberFulfillment;
  loavesPerWeek: number;
  disabled: boolean;
  onSave: (selection: BreadClubSelection[]) => void;
}) {
  const [slots, setSlots] = useState(() =>
    selectionSlots(fulfillment.selection, loavesPerWeek),
  );
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <div className={`grid gap-3 ${loavesPerWeek === 2 ? "sm:grid-cols-2" : ""}`}>
        {slots.map((productId, index) => (
          <label
            key={`${fulfillment.id}-slot-${index}`}
            className="text-sm font-bold text-stone-800"
          >
            {loavesPerWeek === 2 ? `Loaf ${index + 1}` : "Loaf"}
            <select
              value={productId}
              disabled={disabled}
              onChange={(event) =>
                setSlots((current) =>
                  current.map((value, slotIndex) =>
                    slotIndex === index ? event.target.value : value,
                  ),
                )
              }
              className="mt-2 h-11 w-full border border-stone-300 bg-white px-3 font-normal"
            >
              <option value="">Choose bread</option>
              {fulfillment.availableProducts
                .filter(
                  (product) =>
                    !product.unavailable &&
                    (product.remainingQuantity > 0 ||
                      fulfillment.selection.some(
                        (item) => item.productId === product.id,
                      )),
                )
                .map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || slots.some((slot) => !slot)}
        onClick={() => onSave(groupedSelection(slots))}
      >
        <Save size={16} />
        Save selection
      </Button>
    </div>
  );
}

export function BreadClubMemberDashboard({
  initialMember,
  plans,
}: {
  initialMember: BreadClubMemberData;
  plans: BreadClubPlan[];
}) {
  const [member, setMember] = useState(initialMember);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [addonQuantities, setAddonQuantities] = useState<
    Record<string, number>
  >({});
  const [planId, setPlanId] = useState(member.plan.id);
  const [planSelectionSlots, setPlanSelectionSlots] = useState(() =>
    selectionSlots(
      member.fulfillments.find((item) => item.status === "scheduled")
        ?.selection || [],
      member.plan.loavesPerWeek,
    ),
  );
  const [address, setAddress] = useState({
    line1: member.deliveryAddress.line1,
    line2: member.deliveryAddress.line2 || "",
    city: member.deliveryAddress.city,
    state: member.deliveryAddress.state,
    postalCode: member.deliveryAddress.postalCode,
  });
  const [deliveryInstructions, setDeliveryInstructions] = useState(
    member.deliveryInstructions || "",
  );
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const scheduled = useMemo(
    () =>
      member.fulfillments
        .filter((item) => item.status === "scheduled")
        .sort(
          (left, right) =>
            new Date(left.deliveryStartsAt).getTime() -
            new Date(right.deliveryStartsAt).getTime(),
        ),
    [member.fulfillments],
  );
  const nextSunday = scheduled[0] || null;
  const availableCredits = member.credits.filter(
    (credit) => credit.status === "available",
  );
  const selectedPlan =
    plans.find((plan) => plan.id === planId) || member.plan;

  function runAction(
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/bread-club/member", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as {
          member?: BreadClubMemberData;
          url?: string;
          error?: string;
          billingCreditPending?: boolean;
        };
        if (!response.ok) {
          setError(payload.error || "Bread Club could not be updated.");
          return;
        }
        if (payload.url) {
          window.location.assign(payload.url);
          return;
        }
        if (payload.member) setMember(payload.member);
        setMessage(
          payload.billingCreditPending
            ? `${successMessage} The delivery billing credit is queued for owner reconciliation.`
            : successMessage,
        );
      } catch {
        setError("Bread Club could not be updated. Please try again.");
      }
    });
  }

  function openBillingPortal() {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/bread-club/portal", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !payload.url) {
        setError(payload.error || "Stripe billing could not be opened.");
        return;
      }
      window.location.assign(payload.url);
    });
  }

  function choosePlan(nextPlanId: string) {
    setPlanId(nextPlanId);
    const nextPlan = plans.find((plan) => plan.id === nextPlanId);
    const firstProduct = nextPlan?.eligibleProducts[0]?.id || "";
    setPlanSelectionSlots(
      Array.from(
        { length: nextPlan?.loavesPerWeek || 1 },
        () => firstProduct,
      ),
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold uppercase text-[#a94334]">
            Sunday Bread Club
          </p>
          <h1 className="mt-2 text-3xl font-bold text-stone-950">
            Hi {member.customerName}
          </h1>
          <p className="mt-2 text-sm text-stone-700">
            {member.plan.name} - {formatCurrency(member.currentCycle?.totalCents || 0)} every four weeks
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={openBillingPortal}>
            <CreditCard size={16} />
            Billing and invoices
          </Button>
          <form action="/api/bread-club/auth/logout" method="post">
            <Button type="submit" variant="ghost">
              <LogOut size={16} />
              Sign out
            </Button>
          </form>
        </div>
      </div>

      {message ? (
        <div
          className="flex gap-2 border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"
          role="status"
        >
          <CheckCircle2 size={18} className="shrink-0" />
          {message}
        </div>
      ) : null}
      {error ? (
        <div
          className="flex gap-2 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900"
          role="alert"
        >
          <TriangleAlert size={18} className="shrink-0" />
          {error}
        </div>
      ) : null}

      {member.status === "past_due" ? (
        <section className="border border-red-300 bg-red-50 p-5">
          <h2 className="font-bold text-red-950">Payment method needs attention</h2>
          <p className="mt-2 text-sm leading-6 text-red-900">
            Stripe could not complete the latest renewal. Open billing to
            update the payment method before Grace begins the next bake cycle.
          </p>
          <Button type="button" className="mt-4" onClick={openBillingPortal}>
            <CreditCard size={16} />
            Update payment
          </Button>
        </section>
      ) : null}

      {nextSunday ? (
        <section className="border border-[#23443b] bg-white p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row">
            <div>
              <p className="text-xs font-bold uppercase text-[#a94334]">
                Next delivery
              </p>
              <h2 className="mt-2 text-2xl font-bold text-stone-950">
                {formatDate(nextSunday.deliveryStartsAt)}
              </h2>
              <p className="mt-1 text-sm text-stone-700">3:00-6:00 PM</p>
            </div>
            <div className="text-sm text-stone-700 sm:text-right">
              <p className="font-bold text-stone-950">Change by</p>
              <p>{formatDate(nextSunday.cutoffAt, true)}</p>
            </div>
          </div>
          <SundaySelectionEditor
            fulfillment={nextSunday}
            loavesPerWeek={member.plan.loavesPerWeek}
            disabled={isPending || new Date(nextSunday.cutoffAt) <= new Date()}
            onSave={(selection) =>
              runAction(
                {
                  action: "change_selection",
                  fulfillmentId: nextSunday.id,
                  selection,
                },
                "Next Sunday selection saved.",
              )
            }
          />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
            <p className="text-sm text-stone-600">
              {member.currentCycle?.skipCount || 0} of 1 cycle skip used
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={
                isPending ||
                (member.currentCycle?.skipCount || 0) >= 1 ||
                new Date(nextSunday.cutoffAt) <= new Date()
              }
              onClick={() =>
                runAction(
                  { action: "skip", fulfillmentId: nextSunday.id },
                  "Sunday skipped and rollover credit created.",
                )
              }
            >
              <CalendarX2 size={16} />
              Skip this Sunday
            </Button>
          </div>
        </section>
      ) : (
        <section className="border border-stone-200 bg-white p-5">
          <h2 className="font-bold text-stone-950">No upcoming paid delivery</h2>
          <p className="mt-2 text-sm text-stone-700">
            Check billing status or contact the bakery if a renewal should be active.
          </p>
        </section>
      )}

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase text-[#a94334]">
              Four-Sunday timeline
            </p>
            <h2 className="mt-2 text-2xl font-bold text-stone-950">
              Upcoming deliveries
            </h2>
          </div>
          <span className="text-sm font-semibold text-stone-600">
            {scheduled.length} scheduled
          </span>
        </div>
        <div className="mt-5 divide-y divide-stone-200 border border-stone-200 bg-white">
          {member.fulfillments.map((fulfillment) => (
            <div
              key={fulfillment.id}
              className="grid gap-4 p-4 lg:grid-cols-[220px_1fr_auto] lg:items-center"
            >
              <div>
                <p className="font-bold text-stone-950">
                  {formatDate(fulfillment.deliveryStartsAt)}
                </p>
                <span className="mt-1 inline-flex rounded-sm bg-stone-100 px-2 py-1 text-xs font-bold text-stone-700">
                  {fulfillment.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="text-sm text-stone-700">
                {fulfillment.items
                  .map((item) => `${item.quantity} x ${item.productName}`)
                  .join(", ") || "Selection pending"}
              </p>
              {fulfillment.status === "scheduled" ? (
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#23443b]">
                  <CalendarCheck2 size={16} />
                  Reserved
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {nextSunday?.availableAddons.length ? (
        <section className="border-t border-stone-200 pt-8">
          <p className="text-sm font-bold uppercase text-[#a94334]">
            Add to next Sunday
          </p>
          <h2 className="mt-2 text-2xl font-bold text-stone-950">
            Add-ons with no second delivery fee
          </h2>
          <div className="mt-5 divide-y divide-stone-200 border border-stone-200 bg-white">
            {nextSunday.availableAddons.map((addon) => (
              <div
                key={addon.id}
                className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <p className="font-bold text-stone-950">{addon.name}</p>
                  <p className="mt-1 text-sm text-stone-600">
                    {formatCurrency(addon.priceCents)} - {addon.remainingQuantity} available
                  </p>
                </div>
                <select
                  aria-label={`${addon.name} add-on quantity`}
                  value={addonQuantities[addon.id] || 0}
                  onChange={(event) =>
                    setAddonQuantities((current) => ({
                      ...current,
                      [addon.id]: Number(event.target.value),
                    }))
                  }
                  className="h-10 w-24 border border-stone-300 bg-white px-2"
                >
                  {Array.from(
                    { length: Math.min(addon.remainingQuantity, 4) + 1 },
                    (_, quantity) => (
                      <option key={quantity} value={quantity}>
                        {quantity}
                      </option>
                    ),
                  )}
                </select>
              </div>
            ))}
          </div>
          <Button
            type="button"
            className="mt-4"
            disabled={
              isPending ||
              !Object.values(addonQuantities).some((quantity) => quantity > 0)
            }
            onClick={() =>
              runAction(
                {
                  action: "addon_checkout",
                  fulfillmentId: nextSunday.id,
                  items: Object.entries(addonQuantities)
                    .filter(([, quantity]) => quantity > 0)
                    .map(([productId, quantity]) => ({ productId, quantity })),
                },
                "Opening add-on checkout.",
              )
            }
          >
            <PackagePlus size={16} />
            Checkout add-ons
          </Button>
        </section>
      ) : null}

      {availableCredits.length ? (
        <section className="border-t border-stone-200 pt-8">
          <p className="text-sm font-bold uppercase text-[#a94334]">
            Rollover balance
          </p>
          <h2 className="mt-2 text-2xl font-bold text-stone-950">
            Use a skipped-loaf credit
          </h2>
          <div className="mt-5 space-y-3">
            {availableCredits.map((credit) => (
              <div
                key={credit.id}
                className="grid gap-4 border border-stone-200 bg-white p-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end"
              >
                <div>
                  <p className="font-bold text-stone-950">
                    {credit.quantity} loaf credit
                  </p>
                  <p className="mt-1 text-sm text-stone-600">
                    Expires {formatDate(credit.expiresAt)}
                  </p>
                </div>
                <label className="text-sm font-bold text-stone-800">
                  Sunday
                  <select
                    id={`credit-week-${credit.id}`}
                    className="mt-2 h-10 w-full border border-stone-300 bg-white px-2 font-normal"
                  >
                    {scheduled.map((fulfillment) => (
                      <option key={fulfillment.id} value={fulfillment.id}>
                        {formatDate(fulfillment.deliveryStartsAt)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-bold text-stone-800">
                  Bread
                  <select
                    id={`credit-product-${credit.id}`}
                    className="mt-2 h-10 w-full border border-stone-300 bg-white px-2 font-normal"
                  >
                    {nextSunday?.availableProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isPending || !scheduled.length}
                  onClick={() => {
                    const week = document.getElementById(
                      `credit-week-${credit.id}`,
                    ) as HTMLSelectElement | null;
                    const product = document.getElementById(
                      `credit-product-${credit.id}`,
                    ) as HTMLSelectElement | null;
                    if (!week?.value || !product?.value) return;
                    runAction(
                      {
                        action: "redeem_credit",
                        creditId: credit.id,
                        fulfillmentId: week.value,
                        productId: product.value,
                      },
                      "Rollover loaf added to the selected Sunday.",
                    );
                  }}
                >
                  <RefreshCw size={16} />
                  Apply credit
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="border-t border-stone-200 pt-8">
        <p className="text-sm font-bold uppercase text-[#a94334]">
          Membership settings
        </p>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div className="border border-stone-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <MapPin size={18} className="text-[#23443b]" />
              <h2 className="font-bold text-stone-950">Delivery address</h2>
            </div>
            <div className="mt-4 space-y-3">
              <input
                aria-label="Bread Club street address"
                value={address.line1}
                onChange={(event) =>
                  setAddress((current) => ({ ...current, line1: event.target.value }))
                }
                className="h-10 w-full border border-stone-300 px-3"
              />
              <input
                aria-label="Bread Club apartment or unit"
                value={address.line2}
                onChange={(event) =>
                  setAddress((current) => ({ ...current, line2: event.target.value }))
                }
                className="h-10 w-full border border-stone-300 px-3"
                placeholder="Apartment or unit"
              />
              <div className="grid grid-cols-[1fr_70px_95px] gap-2">
                <input
                  aria-label="Bread Club city"
                  value={address.city}
                  onChange={(event) =>
                    setAddress((current) => ({ ...current, city: event.target.value }))
                  }
                  className="h-10 min-w-0 border border-stone-300 px-3"
                />
                <input
                  aria-label="Bread Club state"
                  value={address.state}
                  onChange={(event) =>
                    setAddress((current) => ({ ...current, state: event.target.value }))
                  }
                  className="h-10 min-w-0 border border-stone-300 px-3"
                />
                <input
                  aria-label="Bread Club ZIP"
                  value={address.postalCode}
                  onChange={(event) =>
                    setAddress((current) => ({
                      ...current,
                      postalCode: event.target.value.replace(/\D/g, "").slice(0, 5),
                    }))
                  }
                  className="h-10 min-w-0 border border-stone-300 px-3"
                />
              </div>
              <textarea
                aria-label="Bread Club delivery instructions"
                value={deliveryInstructions}
                onChange={(event) => setDeliveryInstructions(event.target.value)}
                rows={3}
                className="w-full border border-stone-300 p-3"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() =>
                  runAction(
                    {
                      action: "update_address",
                      address,
                      deliveryInstructions,
                    },
                    "Delivery address and route band updated.",
                  )
                }
              >
                <MapPin size={16} />
                Verify and save address
              </Button>
            </div>
          </div>

          <div className="border border-stone-200 bg-white p-5">
            <h2 className="font-bold text-stone-950">Plan for next cycle</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Plan changes begin with the next renewal. Already-paid Sundays do
              not change. Changes lock once the next four Sundays have been
              reserved for renewal.
            </p>
            <label className="mt-4 block text-sm font-bold text-stone-800">
              Plan
              <select
                value={planId}
                onChange={(event) => choosePlan(event.target.value)}
                className="mt-2 h-10 w-full border border-stone-300 bg-white px-3 font-normal"
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} - {formatCurrency(plan.priceCents)}
                  </option>
                ))}
              </select>
            </label>
            <div
              className={`mt-3 grid gap-3 ${
                selectedPlan.loavesPerWeek === 2 ? "sm:grid-cols-2" : ""
              }`}
            >
              {planSelectionSlots.map((productId, index) => (
                <label key={index} className="text-sm font-bold text-stone-800">
                  Default loaf {selectedPlan.loavesPerWeek === 2 ? index + 1 : ""}
                  <select
                    value={productId}
                    onChange={(event) =>
                      setPlanSelectionSlots((current) =>
                        current.map((value, slot) =>
                          slot === index ? event.target.value : value,
                        ),
                      )
                    }
                    className="mt-2 h-10 w-full border border-stone-300 bg-white px-3 font-normal"
                  >
                    {selectedPlan.eligibleProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              disabled={isPending || planSelectionSlots.some((slot) => !slot)}
              onClick={() =>
                runAction(
                  {
                    action: "change_plan",
                    planId,
                    selection: groupedSelection(planSelectionSlots),
                  },
                  "Plan change scheduled for the next renewal.",
                )
              }
            >
              <Save size={16} />
              Schedule plan change
            </Button>
          </div>
        </div>
      </section>

      <section className="border-t border-stone-200 pt-8">
        <div className="border border-red-200 bg-white p-5">
          <h2 className="font-bold text-stone-950">Cancel membership</h2>
          <p className="mt-2 text-sm leading-6 text-stone-700">
            Canceling stops the next renewal. Every already-paid Sunday remains
            scheduled. Available rollover credits are refunded when the
            membership ends. You can also request cancellation by emailing{" "}
            <a
              className="font-semibold text-[#23443b] underline"
              href="mailto:orders@landlsourdough.com?subject=Bread%20Club%20cancellation"
            >
              orders@landlsourdough.com
            </a>
            .
          </p>
          {member.cancelAtPeriodEnd ? (
            <p className="mt-4 inline-flex items-center gap-2 font-bold text-[#a94334]">
              <CheckCircle2 size={17} />
              Cancellation is already scheduled.
            </p>
          ) : (
            <>
              <textarea
                aria-label="Cancellation reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                rows={2}
                className="mt-4 w-full max-w-xl border border-stone-300 p-3 text-sm"
                placeholder="Optional reason"
              />
              <label className="mt-4 flex max-w-xl items-start gap-3 text-sm leading-6 text-stone-800">
                <input
                  type="checkbox"
                  checked={cancelConfirmed}
                  onChange={(event) => setCancelConfirmed(event.target.checked)}
                  className="mt-1 size-4 accent-[#a94334]"
                />
                I understand this stops the next renewal and keeps already-paid
                deliveries.
              </label>
              <Button
                type="button"
                variant="warm"
                className="mt-4"
                disabled={isPending || !cancelConfirmed}
                onClick={() =>
                  runAction(
                    { action: "cancel", reason: cancelReason },
                    "Cancellation scheduled. No further renewal will be charged.",
                  )
                }
              >
                <CalendarX2 size={16} />
                Cancel future renewals
              </Button>
            </>
          )}
        </div>
      </section>

      {isPending ? (
        <div
          className="fixed bottom-5 right-5 flex items-center gap-2 rounded-md bg-[#23443b] px-4 py-3 text-sm font-bold text-white shadow-lg"
          role="status"
        >
          <Loader2 className="animate-spin" size={17} />
          Saving Bread Club update...
        </div>
      ) : null}
    </div>
  );
}
