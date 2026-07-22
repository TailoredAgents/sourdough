"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import {
  getAdminPayloadError,
  hasAdminKeys,
  readAdminJsonResponse,
} from "@/lib/admin-api";
import {
  buildMailtoHref,
  buildMapSearchHref,
  buildTelHref,
  formatDeliveryAddress,
} from "@/lib/admin-contact-links";
import { getAdminOrderStatusActions } from "@/lib/admin-order-workflow";
import type { AdminOrder, OrderStatus } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Button, buttonClassName } from "./button";

const statusLabels: Record<OrderStatus, string> = {
  draft: "Draft",
  pending_payment: "Pending payment",
  pending_approval_payment: "Approval payment",
  pending_approval: "Needs approval",
  paid: "Paid",
  baking: "Baking",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  canceled: "Canceled",
};

const statusOptions: OrderStatus[] = [
  "pending_payment",
  "paid",
  "baking",
  "out_for_delivery",
  "delivered",
  "canceled",
];

const activeStatuses: OrderStatus[] = [
  "pending_approval",
  "paid",
  "baking",
  "out_for_delivery",
];

type OrderFilter = OrderStatus | "all" | "active" | "needs_approval";

const filterOptions: OrderFilter[] = [
  "needs_approval",
  "active",
  "all",
  "pending_payment",
  "pending_approval_payment",
  "pending_approval",
  "paid",
  "baking",
  "out_for_delivery",
  "delivered",
  "canceled",
];

function matchesOrderFilter(order: AdminOrder, filter: OrderFilter) {
  if (filter === "needs_approval") return order.status === "pending_approval";
  if (filter === "active") return activeStatuses.includes(order.status);
  if (filter === "all") return true;
  return order.status === filter;
}

function formatDate(value: string | null) {
  if (!value) return "Not paid";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function shortId(id: string) {
  return id.slice(0, 8);
}

export function OrderDashboard({ initialOrders }: { initialOrders: AdminOrder[] }) {
  const firstApprovalOrder = initialOrders.find(
    (order) => order.status === "pending_approval",
  );
  const firstActiveOrder = initialOrders.find((order) =>
    activeStatuses.includes(order.status),
  );
  const [orders, setOrders] = useState<AdminOrder[]>(initialOrders);
  const [selectedId, setSelectedId] = useState<string | null>(
    firstApprovalOrder?.id ?? firstActiveOrder?.id ?? initialOrders[0]?.id ?? null,
  );
  const [filter, setFilter] = useState<OrderFilter>(
    firstApprovalOrder ? "needs_approval" : firstActiveOrder ? "active" : "all",
  );
  const [moveWindowIds, setMoveWindowIds] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredOrders = useMemo(
    () => orders.filter((order) => matchesOrderFilter(order, filter)),
    [filter, orders],
  );
  const selectedOrder =
    filteredOrders.find((order) => order.id === selectedId) ?? filteredOrders[0] ?? null;
  const openOrdersCount = orders.filter((order) =>
    activeStatuses.includes(order.status),
  ).length;
  const pendingPaymentCount = orders.filter((order) => order.status === "pending_payment").length;
  const approvalCount = orders.filter((order) => order.status === "pending_approval").length;
  const statusActions = selectedOrder
    ? getAdminOrderStatusActions(selectedOrder.status)
    : [];
  const selectedOrderShortId = selectedOrder ? shortId(selectedOrder.id) : "";
  const customerEmailHref = selectedOrder
    ? buildMailtoHref(
        selectedOrder.customerEmail,
        `Order #${selectedOrderShortId} from Luna & Lorelai's Sourdough`,
      )
    : null;
  const customerPhoneHref = selectedOrder
    ? buildTelHref(selectedOrder.customerPhone)
    : null;
  const deliveryAddressText = selectedOrder
    ? formatDeliveryAddress(selectedOrder.deliveryAddress)
    : "";
  const deliveryMapHref = selectedOrder
    ? buildMapSearchHref(selectedOrder.deliveryAddress)
    : null;

  function updateStatus(id: string, status: OrderStatus) {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status }),
        });
        const payload = await readAdminJsonResponse(response);

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["orders"]) ||
          !Array.isArray(payload.orders)
        ) {
          setMessage(getAdminPayloadError(payload) || "Order could not be updated.");
          return;
        }

        setOrders(payload.orders as AdminOrder[]);
        setSelectedId(id);
        setFilter(activeStatuses.includes(status) ? "active" : status);
        setMessage("Order updated.");
      } catch {
        setMessage("Order could not be updated. Check your connection and try again.");
      }
    });
  }

  function runApprovalAction(
    id: string,
    action: "accept_request" | "deny_refund" | "move_to_next_week",
    targetDeliveryWindowId?: string,
  ) {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action, targetDeliveryWindowId }),
        });
        const payload = await readAdminJsonResponse(response);

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["orders"]) ||
          !Array.isArray(payload.orders)
        ) {
          setMessage(getAdminPayloadError(payload) || "Approval request could not be updated.");
          return;
        }

        setOrders(payload.orders as AdminOrder[]);
        setSelectedId(id);
        setFilter(action === "deny_refund" ? "canceled" : "active");
        setMessage("Order updated.");
      } catch {
        setMessage("Approval request could not be updated. Check your connection and try again.");
      }
    });
  }

  function selectFilter(nextFilter: OrderFilter) {
    setFilter(nextFilter);
    setSelectedId(orders.find((order) => matchesOrderFilter(order, nextFilter))?.id ?? null);
    setMessage(null);
  }

  return (
    <section id="orders" className="mt-8 scroll-mt-28 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="text-[#a94334]" size={20} />
            <h2 className="text-xl font-bold text-stone-950">Order dashboard</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Review approval requests and track paid orders through baking, delivery, and completion.
          </p>
        </div>
        <div className="rounded-md border border-stone-200 bg-[#fffaf2] px-3 py-2 text-sm font-semibold text-stone-700">
          {approvalCount} need approval - {openOrdersCount} active - {pendingPaymentCount} unpaid
        </div>
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {filterOptions.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => selectFilter(status)}
            className={`h-9 whitespace-nowrap rounded-md border px-3 text-sm font-semibold ${
              filter === status
                ? "border-[#23443b] bg-[#23443b] text-white"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
            }`}
          >
            {status === "active"
              ? "Active"
              : status === "all"
                ? "All"
                : status === "needs_approval"
                  ? "Needs approval"
                  : statusLabels[status]}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="grid max-h-[580px] content-start gap-2 overflow-y-auto pr-1">
          {filteredOrders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => {
                setSelectedId(order.id);
                setMessage(null);
              }}
              className={`rounded-md border p-3 text-left transition ${
                selectedOrder?.id === order.id
                  ? "border-[#23443b] bg-[#f7efe3]"
                  : "border-stone-200 bg-white hover:bg-stone-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-stone-950">
                    #{shortId(order.id)} - {order.customerName}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {formatDate(order.createdAt)}
                  </p>
                </div>
                <span
                  className={`rounded-sm px-2 py-1 text-xs font-bold uppercase ${
                    order.status === "pending_approval"
                      ? "bg-[#a94334] text-white"
                      : activeStatuses.includes(order.status)
                      ? "bg-emerald-50 text-emerald-800"
                      : order.status === "canceled"
                        ? "bg-stone-100 text-stone-600"
                        : "bg-amber-50 text-amber-900"
                  }`}
                >
                  {statusLabels[order.status]}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-sm text-stone-700">
                <span>
                  {order.status === "pending_approval"
                    ? "Decision needed"
                    : order.status === "pending_payment" ||
                        order.status === "pending_approval_payment"
                    ? "Not paid yet"
                    : `${order.items.length} items`}
                </span>
                <span className="font-bold text-[#23443b]">
                  {formatCurrency(order.totalCents)}
                </span>
              </div>
            </button>
          ))}

          {!filteredOrders.length ? (
            <div className="rounded-md border border-dashed border-stone-300 bg-[#fffaf2] p-5 text-sm text-stone-700">
              No orders match this status yet.
            </div>
          ) : null}
        </div>

        <div className="rounded-md border border-stone-100 bg-[#fffaf2] p-4">
          {selectedOrder ? (
            <>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-[#a94334]">
                    {statusLabels[selectedOrder.status]}
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-stone-950">
                    Order #{shortId(selectedOrder.id)}
                  </h3>
                  <p className="mt-1 text-sm text-stone-600">
                    {selectedOrder.customerName} - {selectedOrder.customerEmail}
                  </p>
                  {selectedOrder.customerPhone ? (
                    <p className="mt-1 text-sm text-stone-600">
                      {selectedOrder.customerPhone}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {customerEmailHref ? (
                      <a
                        className={buttonClassName({
                          variant: "secondary",
                          size: "sm",
                        })}
                        href={customerEmailHref}
                      >
                        <Mail size={15} />
                        Email
                      </a>
                    ) : null}
                    {customerPhoneHref ? (
                      <a
                        className={buttonClassName({
                          variant: "secondary",
                          size: "sm",
                        })}
                        href={customerPhoneHref}
                      >
                        <Phone size={15} />
                        Call
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="text-right text-sm font-bold text-[#23443b]">
                  {formatCurrency(selectedOrder.totalCents)}
                </div>
              </div>

              {selectedOrder.status === "pending_payment" ||
              selectedOrder.status === "pending_approval_payment" ? (
                <div className="mt-4 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                  <AlertTriangle className="mt-0.5 shrink-0" size={16} />
                  <p>
                    Payment is not confirmed. Work this order only after Stripe marks it
                    paid or manual payment is verified.
                    {selectedOrder.status === "pending_payment"
                      ? " Canceling releases the reserved delivery spot and menu inventory."
                      : " This request has not reserved inventory yet."}
                  </p>
                </div>
              ) : null}

              {selectedOrder.status === "pending_approval" ? (
                <div className="mt-4 grid gap-3 rounded-md border border-[#a94334]/30 bg-white p-4 text-sm leading-6 text-stone-700">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 shrink-0 text-[#a94334]" size={16} />
                    <div>
                      <p className="font-semibold text-stone-950">
                        Paid same-week request needs a decision
                      </p>
                      <p className="mt-1">
                        Accepting reserves this Sunday&apos;s inventory and delivery spot.
                        Denying refunds the Stripe payment. Moving to next Sunday is only
                        available if the customer said next Sunday works.
                      </p>
                      <p className="mt-1 font-semibold text-stone-950">
                        Next Sunday works: {selectedOrder.nextWeekOk ? "Yes" : "No"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button
                      type="button"
                      disabled={isPending}
                      onClick={() => runApprovalAction(selectedOrder.id, "accept_request")}
                    >
                      {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
                      Accept request
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => runApprovalAction(selectedOrder.id, "deny_refund")}
                    >
                      {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
                      Deny & refund
                    </Button>
                  </div>
                  {selectedOrder.nextWeekOk ? (
                    <div className="grid gap-2 border-t border-stone-200 pt-3">
                      <label className="grid gap-1 font-semibold text-stone-700">
                        Move to next Sunday
                        <select
                          className="h-11 rounded-md border border-stone-300 bg-white px-3 font-normal"
                          value={
                            moveWindowIds[selectedOrder.id] ||
                            selectedOrder.moveWindows[0]?.id ||
                            ""
                          }
                          onChange={(event) =>
                            setMoveWindowIds((current) => ({
                              ...current,
                              [selectedOrder.id]: event.target.value,
                            }))
                          }
                          disabled={isPending || !selectedOrder.moveWindows.length}
                        >
                          {!selectedOrder.moveWindows.length ? (
                            <option value="">No next Sunday slots available</option>
                          ) : null}
                          {selectedOrder.moveWindows.map((window) => (
                            <option key={window.id} value={window.id}>
                              {window.weeklyMenuName} - {window.label} (
                              {window.capacity - window.reserved} spots left)
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isPending || !selectedOrder.moveWindows.length}
                        onClick={() =>
                          runApprovalAction(
                            selectedOrder.id,
                            "move_to_next_week",
                            moveWindowIds[selectedOrder.id] ||
                              selectedOrder.moveWindows[0]?.id,
                          )
                        }
                      >
                        {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
                        Move to next Sunday
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selectedOrder.status === "canceled" ? (
                <div className="mt-4 flex gap-2 rounded-md border border-stone-200 bg-white p-3 text-sm leading-6 text-stone-700">
                  <AlertTriangle className="mt-0.5 shrink-0 text-[#a94334]" size={16} />
                  <p>
                    This order is canceled. Restoring it will try to reserve the Sunday delivery
                    spot and product inventory again before marking it paid.
                  </p>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 rounded-md border border-stone-200 bg-white p-4 text-sm text-stone-700">
                <div className="flex gap-2">
                  <MapPin className="mt-0.5 text-[#a94334]" size={16} />
                  <div>
                    <p className="font-semibold text-stone-950">
                      {selectedOrder.deliveryWindowLabel || "No Sunday delivery time"}
                    </p>
                    <p className="mt-1">{deliveryAddressText}</p>
                    {deliveryMapHref ? (
                      <a
                        className={buttonClassName({
                          variant: "ghost",
                          size: "sm",
                          className: "mt-2 w-fit px-0 text-[#23443b] hover:bg-transparent",
                        })}
                        href={deliveryMapHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin size={15} />
                        Open map
                      </a>
                    ) : null}
                    {selectedOrder.deliveryMiles !== null ? (
                      <p className="mt-1">{selectedOrder.deliveryMiles} miles estimated</p>
                    ) : null}
                    {selectedOrder.deliveryInstructions ? (
                      <p className="mt-1">
                        Instructions: {selectedOrder.deliveryInstructions}
                      </p>
                    ) : null}
                  </div>
                </div>
                <p>Paid: {formatDate(selectedOrder.paidAt)}</p>
              </div>

              <div className="mt-4 overflow-x-auto rounded-md border border-stone-200 bg-white">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-3">Item</th>
                      <th className="px-3 py-3">Qty</th>
                      <th className="px-3 py-3">Each</th>
                      <th className="px-3 py-3">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {selectedOrder.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-3 font-semibold text-stone-950">
                          {item.productName}
                        </td>
                        <td className="px-3 py-3 text-stone-700">{item.quantity}</td>
                        <td className="px-3 py-3 text-stone-700">
                          {formatCurrency(item.unitPriceCents)}
                        </td>
                        <td className="px-3 py-3 text-stone-700">
                          {formatCurrency(item.unitPriceCents * item.quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid gap-2 rounded-md border border-stone-200 bg-white p-4 text-sm text-stone-700">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(selectedOrder.subtotalCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Delivery</span>
                  <span>{formatCurrency(selectedOrder.deliveryFeeCents)}</span>
                </div>
                <div className="flex justify-between font-bold text-stone-950">
                  <span>Total</span>
                  <span>{formatCurrency(selectedOrder.totalCents)}</span>
                </div>
              </div>

              {selectedOrder.notes ? (
                <div className="mt-4 rounded-md border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-700">
                  <p className="font-semibold text-stone-950">Notes</p>
                  <p className="mt-1">{selectedOrder.notes}</p>
                </div>
              ) : null}

              {selectedOrder.stripeCheckoutSessionId ? (
                <details className="mt-4 rounded-md border border-stone-200 bg-white p-4 text-sm text-stone-700">
                  <summary className="cursor-pointer font-semibold text-stone-950">
                    Payment reference
                  </summary>
                  <p className="mt-2 break-all">
                    Stripe session: {selectedOrder.stripeCheckoutSessionId}
                  </p>
                </details>
              ) : null}

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                {statusActions.map((action) => (
                  <Button
                    key={action.status}
                    type="button"
                    variant={
                      action.variant === "secondary"
                        ? "secondary"
                        : action.variant === "ghost"
                          ? "ghost"
                          : "primary"
                    }
                    disabled={isPending}
                    onClick={() => updateStatus(selectedOrder.id, action.status)}
                  >
                    {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
                    {action.label}
                  </Button>
                ))}
                {selectedOrder.status === "pending_approval" ||
                selectedOrder.status === "pending_approval_payment" ? null : (
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Manual status
                    <select
                      className="h-11 rounded-md border border-stone-300 bg-white px-3 font-normal"
                      value={selectedOrder.status}
                      onChange={(event) =>
                        updateStatus(selectedOrder.id, event.target.value as OrderStatus)
                      }
                      disabled={isPending}
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {statusLabels[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {message ? (
                  <span
                    className={`inline-flex items-center gap-2 text-sm font-semibold ${
                      message === "Order updated." ? "text-emerald-800" : "text-[#a94334]"
                    }`}
                  >
                    {message === "Order updated." ? <CheckCircle2 size={16} /> : null}
                    {message}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-stone-300 bg-white p-5 text-sm text-stone-700">
              No order selected for this filter.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
