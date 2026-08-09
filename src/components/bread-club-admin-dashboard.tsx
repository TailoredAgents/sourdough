"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Loader2,
  Mail,
  PackageCheck,
  Printer,
  RefreshCw,
  Save,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import type {
  BreadClubAdminData,
  BreadClubAdminMember,
} from "@/lib/bread-club/admin";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";

function formatDate(value: string | null, withTime = false) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function readinessLabel(ready: boolean) {
  return ready ? "Ready" : "Action needed";
}

function MemberDetail({
  member,
  pending,
  onAction,
}: {
  member: BreadClubAdminMember;
  pending: boolean;
  onAction: (body: Record<string, unknown>, message: string) => void;
}) {
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  return (
    <div className="min-w-0 border border-stone-200 bg-white">
      <div className="border-b border-stone-200 p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-stone-950">
                {member.customerName}
              </h2>
              <span className="rounded-sm bg-[#edf4f0] px-2 py-1 text-xs font-bold text-[#23443b]">
                {member.status.replaceAll("_", " ")}
              </span>
            </div>
            <p className="mt-2 text-sm text-stone-700">
              {member.customerEmail}
              {member.customerPhone ? ` - ${member.customerPhone}` : ""}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="font-bold text-stone-950">{member.plan.name}</p>
            <p className="mt-1 text-sm text-stone-600">
              {formatCurrency(member.currentCycle?.totalCents || 0)} per cycle
            </p>
          </div>
        </div>
        {member.providerSyncRequired ? (
          <div className="mt-4 border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
            <p className="font-bold">Saved change is waiting on Stripe</p>
            <p>
              {member.providerSyncError ||
                "Automatic reconciliation is in progress. Renewals are safely paused until Stripe confirms the saved plan or delivery change."}
            </p>
            {member.providerSyncAttemptedAt ? (
              <p className="mt-1 text-xs text-amber-800">
                Last attempted {formatDate(member.providerSyncAttemptedAt, true)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-0 divide-y divide-stone-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <section className="p-5">
          <h3 className="font-bold text-stone-950">Four-Sunday timeline</h3>
          <div className="mt-4 divide-y divide-stone-200 border border-stone-200">
            {member.fulfillments.map((fulfillment) => (
              <div key={fulfillment.id} className="p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-stone-950">
                    {formatDate(fulfillment.deliveryStartsAt)}
                  </p>
                  <span className="text-xs font-bold uppercase text-stone-500">
                    {fulfillment.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-700">
                  {fulfillment.items
                    .map(
                      (item) =>
                        `${item.quantity} x ${item.productName}`,
                    )
                    .join(", ") || "No items"}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="p-5">
          <h3 className="font-bold text-stone-950">Delivery and billing</h3>
          <dl className="mt-4 grid grid-cols-[130px_1fr] gap-x-3 gap-y-3 text-sm">
            <dt className="font-semibold text-stone-600">Address</dt>
            <dd className="min-w-0 text-stone-900">
              {member.deliveryAddress.line1}
              {member.deliveryAddress.line2
                ? `, ${member.deliveryAddress.line2}`
                : ""}
              , {member.deliveryAddress.city}, {member.deliveryAddress.state}{" "}
              {member.deliveryAddress.postalCode}
            </dd>
            <dt className="font-semibold text-stone-600">Route band</dt>
            <dd className="text-stone-900">
              {member.routeBandKey} -{" "}
              {formatCurrency(member.routeFeeCents)} per Sunday
            </dd>
            <dt className="font-semibold text-stone-600">Stripe customer</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-stone-700">
              {member.stripeCustomerId || "Not attached"}
            </dd>
            <dt className="font-semibold text-stone-600">Subscription</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-stone-700">
              {member.stripeSubscriptionId || "Not attached"}
            </dd>
            <dt className="font-semibold text-stone-600">Invoice</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-stone-700">
              {member.stripeInvoiceId || "Not attached"}
            </dd>
          </dl>

          <div className="mt-5 border-t border-stone-200 pt-4">
            <h4 className="text-sm font-bold text-stone-950">
              Estimated plan contribution
            </h4>
            {member.estimatedContributionCents === null ? (
              <p className="mt-2 text-sm leading-6 text-amber-900">
                Add estimated ingredient costs to every selected product to
                calculate contribution.
              </p>
            ) : (
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt>Estimated ingredients</dt>
                  <dd>
                    {formatCurrency(
                      member.estimatedIngredientCostCents || 0,
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Estimated Stripe fees</dt>
                  <dd>{formatCurrency(member.estimatedStripeFeeCents)}</dd>
                </div>
                <div className="flex justify-between gap-4 font-bold">
                  <dt>Contribution before other costs</dt>
                  <dd>
                    {formatCurrency(member.estimatedContributionCents)}
                  </dd>
                </div>
              </dl>
            )}
            <p className="mt-3 text-xs leading-5 text-stone-500">
              Excludes unrecorded labor, packaging, delivery labor, fuel, and
              overhead.
            </p>
          </div>
        </section>
      </div>

      <div className="border-t border-stone-200 p-5">
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              onAction(
                {
                  action: "resend_access",
                  membershipId: member.id,
                },
                "Secure member link sent.",
              )
            }
          >
            <Mail size={16} />
            Resend account link
          </Button>
        </div>

        <div className="mt-5 grid gap-4 border-t border-stone-200 pt-5 lg:grid-cols-2">
          <div>
            {member.currentCycle?.status === "refund_pending" ? (
              <div className="mb-3 border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                <p className="font-bold">
                  Stripe refund: {member.currentCycleRefundStatus || "claim saved"}
                </p>
                <p>
                  {member.currentCycleRefundError ||
                    "The refund is safely claimed. Use the button below to retrieve or resume it."}
                </p>
              </div>
            ) : null}
            <label className="flex items-start gap-3 text-sm leading-6 text-stone-700">
              <input
                type="checkbox"
                checked={cancelConfirmed}
                onChange={(event) =>
                  setCancelConfirmed(event.target.checked)
                }
                className="mt-1 size-4 accent-[#a94334]"
              />
              Confirm future renewals should stop. Paid Sundays stay scheduled.
            </label>
            <Button
              type="button"
              variant="warm"
              className="mt-3"
              disabled={
                pending ||
                !cancelConfirmed ||
                member.cancelAtPeriodEnd
              }
              onClick={() =>
                onAction(
                  {
                    action: "cancel_membership",
                    membershipId: member.id,
                    reason: "Canceled by Grace in Bread Club admin",
                  },
                  "Membership cancellation scheduled.",
                )
              }
            >
              <XCircle size={16} />
              Stop future renewals
            </Button>
          </div>

          <div>
            <label className="flex items-start gap-3 text-sm leading-6 text-stone-700">
              <input
                type="checkbox"
                checked={refundConfirmed}
                onChange={(event) =>
                  setRefundConfirmed(event.target.checked)
                }
                className="mt-1 size-4 accent-[#a94334]"
              />
              Confirm the full current cycle should be refunded and all
              unstarted Sunday reservations released.
            </label>
            <Button
              type="button"
              variant="warm"
              className="mt-3"
              disabled={
                pending ||
                !refundConfirmed ||
                !["paid", "refund_pending"].includes(
                  member.currentCycle?.status || "",
                )
              }
              onClick={() =>
                member.currentCycle
                  ? onAction(
                      {
                        action: "refund_cycle",
                        membershipId: member.id,
                        cycleId: member.currentCycle.id,
                        note: "Full cycle refunded by Grace",
                      },
                      "Refund request saved. Its Stripe status is shown below.",
                    )
                  : undefined
              }
            >
              <CircleDollarSign size={16} />
              {member.currentCycle?.status === "refund_pending"
                ? "Resume cycle refund"
                : "Refund current cycle"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BreadClubAdminDashboard({
  initialData,
}: {
  initialData: BreadClubAdminData;
}) {
  const [data, setData] = useState(initialData);
  const [selectedMemberId, setSelectedMemberId] = useState(
    initialData.members[0]?.id || "",
  );
  const [capacity, setCapacity] = useState(
    initialData.settings.maxWeeklyLoafSlots,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedMember = useMemo(
    () =>
      data.members.find((member) => member.id === selectedMemberId) ||
      data.members[0] ||
      null,
    [data.members, selectedMemberId],
  );

  function action(body: Record<string, unknown>, successMessage: string) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/bread-club", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as {
          data?: BreadClubAdminData;
          error?: string;
        };
        if (!response.ok || !payload.data) {
          setError(payload.error || "Bread Club admin action failed.");
          return;
        }
        setData(payload.data);
        setMessage(successMessage);
      } catch {
        setError("Bread Club admin action failed. Please try again.");
      }
    });
  }

  return (
    <main className="bg-[#f7f5f2] py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-7xl space-y-7 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase text-[#a94334]">
              Owner workspace
            </p>
            <h1 className="mt-2 text-3xl font-bold text-stone-950">
              Sunday Bread Club
            </h1>
            <p className="mt-2 text-sm text-stone-600">
              Memberships, Sunday commitments, billing, credits, and production.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.print()}
            >
              <Printer size={16} />
              Print Friday bake sheet
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={() =>
                action(
                  { action: "sync_stripe" },
                  "Bread Club Stripe catalog synchronized.",
                )
              }
            >
              <RefreshCw size={16} />
              Sync Stripe
            </Button>
          </div>
        </div>

        {message ? (
          <div className="flex gap-2 border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 print:hidden">
            <CheckCircle2 size={18} />
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="flex gap-2 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-950 print:hidden">
            <AlertTriangle size={18} />
            {error}
          </div>
        ) : null}

        {data.urgentIssues.length ? (
          <section className="border border-amber-300 bg-amber-50 p-5 print:hidden">
            <div className="flex gap-3">
              <AlertTriangle size={21} className="shrink-0 text-amber-900" />
              <div>
                <h2 className="font-bold text-amber-950">Launch and billing issues</h2>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-amber-950">
                  {data.urgentIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              "Active members",
              data.metrics.activeMembers,
              <Users key="icon" size={18} />,
            ],
            [
              "Four-week revenue",
              formatCurrency(data.metrics.recurringRevenueCents),
              <CircleDollarSign key="icon" size={18} />,
            ],
            [
              "Next Sunday loaf slots",
              `${data.metrics.nextSundayLoafSlots} / ${data.settings.maxWeeklyLoafSlots}`,
              <PackageCheck key="icon" size={18} />,
            ],
            [
              "Payment failures",
              data.metrics.paymentFailures,
              <CreditCard key="icon" size={18} />,
            ],
          ].map(([label, value, icon]) => (
            <div key={String(label)} className="border border-stone-200 bg-white p-4">
              <div className="text-[#23443b]">{icon}</div>
              <p className="mt-3 text-xs font-bold uppercase text-stone-500">
                {label}
              </p>
              <p className="mt-1 text-2xl font-bold text-stone-950">{value}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] print:block">
          <section className="border border-stone-200 bg-white p-5 print:border-0 print:p-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-[#a94334]">
                  Friday bake sheet
                </p>
                <h2 className="mt-2 text-xl font-bold text-stone-950">
                  {data.nextSunday?.label || "No paid Sunday scheduled"}
                </h2>
              </div>
              <span className="text-sm font-bold text-stone-600">
                {data.metrics.nextSundayStops} stops
              </span>
            </div>
            <div className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
              {data.nextSunday?.production.length ? (
                data.nextSunday.production.map((item) => (
                  <div
                    key={item.productName}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <span className="text-sm text-stone-800">
                      {item.productName}
                    </span>
                    <strong>{item.quantity}</strong>
                  </div>
                ))
              ) : (
                <p className="py-4 text-sm text-stone-600">
                  No paid Bread Club production is scheduled.
                </p>
              )}
            </div>
            <div className="mt-5 text-sm text-stone-700 print:hidden">
              <p>
                Rollover liability: {data.metrics.rolloverLoaves} loaf credits
                and{" "}
                {formatCurrency(
                  data.metrics.rolloverDeliveryLiabilityCents,
                )}{" "}
                in delivery credits.
              </p>
            </div>
          </section>

          <section className="border border-stone-200 bg-white p-5 print:hidden">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-bold uppercase text-[#a94334]">
                  Operations
                </p>
                <h2 className="mt-2 text-xl font-bold text-stone-950">
                  Capacity and Stripe readiness
                </h2>
              </div>
              <div className="flex items-end gap-2">
                <label className="text-xs font-bold text-stone-600">
                  Weekly loaf cap
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={capacity}
                    onChange={(event) =>
                      setCapacity(Number(event.target.value))
                    }
                    className="mt-1 h-10 w-24 border border-stone-300 px-3 text-sm"
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() =>
                    action(
                      {
                        action: "set_capacity",
                        maxWeeklyLoafSlots: capacity,
                      },
                      "Bread Club capacity saved.",
                    )
                  }
                >
                  <Save size={16} />
                  Save
                </Button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                ["Recurring plan prices", data.stripeReady.plans],
                ["Recurring delivery prices", data.stripeReady.delivery],
                ["Live webhook", data.stripeReady.webhook],
                ["Billing Portal", data.stripeReady.portal],
              ].map(([label, ready]) => (
                <div
                  key={String(label)}
                  className="flex items-center justify-between gap-3 border border-stone-200 p-3"
                >
                  <span className="text-sm font-semibold text-stone-800">
                    {String(label)}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold ${
                      ready ? "text-emerald-800" : "text-red-800"
                    }`}
                  >
                    {ready ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <XCircle size={15} />
                    )}
                    {readinessLabel(Boolean(ready))}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-stone-600">
              Public enrollment:{" "}
              <strong>{data.publicEnabled ? "Enabled" : "Disabled"}</strong> -
              Tax status: <strong>{data.settings.taxStatus}</strong>
            </p>
          </section>
        </div>

        <section className="grid gap-5 lg:grid-cols-[320px_1fr] print:hidden">
          <div className="border border-stone-200 bg-white">
            <div className="border-b border-stone-200 p-4">
              <h2 className="font-bold text-stone-950">Members</h2>
              <p className="mt-1 text-xs text-stone-500">
                {data.members.length} total records
              </p>
            </div>
            <div className="max-h-[760px] divide-y divide-stone-200 overflow-auto">
              {data.members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedMemberId(member.id)}
                  className={`w-full p-4 text-left ${
                    selectedMember?.id === member.id
                      ? "bg-[#edf4f0]"
                      : "bg-white hover:bg-stone-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-stone-950">
                      {member.customerName}
                    </span>
                    {member.status === "past_due" ? (
                      <AlertTriangle size={16} className="text-red-700" />
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-stone-600">
                    {member.plan.name}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    Joined {formatDate(member.createdAt)}
                  </p>
                </button>
              ))}
              {!data.members.length ? (
                <p className="p-4 text-sm text-stone-600">
                  No Bread Club members yet.
                </p>
              ) : null}
            </div>
          </div>

          {selectedMember ? (
            <MemberDetail
              key={selectedMember.id}
              member={selectedMember}
              pending={isPending}
              onAction={action}
            />
          ) : (
            <div className="border border-stone-200 bg-white p-6 text-sm text-stone-600">
              Select a member to review details.
            </div>
          )}
        </section>
      </div>

      {isPending ? (
        <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-md bg-[#23443b] px-4 py-3 text-sm font-bold text-white shadow-lg print:hidden">
          <Loader2 size={17} className="animate-spin" />
          Updating Bread Club...
        </div>
      ) : null}
    </main>
  );
}
