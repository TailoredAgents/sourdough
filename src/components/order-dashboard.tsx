"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  delivered: "Completed",
  canceled: "Canceled",
};

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

function isOrderSuccessMessage(message: string) {
  return message === "Order updated." || message.startsWith("Order completed");
}

export function getOrderCompletionMessage(notification: unknown) {
  switch (notification) {
    case "sent":
      return "Order completed and thank-you email sent.";
    case "queued":
      return "Order completed. Thank-you email queued for automatic retry.";
    case "already_sent":
      return "Order completed. The thank-you email was already sent earlier.";
    case "skipped":
      return "Order completed. Thank-you email skipped because no customer email is available.";
    default:
      return "Order completed. Thank-you email status could not be confirmed.";
  }
}

export function getOrderStatusUpdateConfirmation(
  order: AdminOrder,
  status: OrderStatus,
) {
  if (status === "canceled") {
    return `Cancel order #${shortId(order.id)} for ${order.customerName}? This releases its reserved inventory and Sunday delivery spot.`;
  }
  if (order.status === "delivered" && status === "out_for_delivery") {
    return `Reopen order #${shortId(order.id)} as out for delivery? This sends the customer another status email. Completing it again will not send a second thank-you email.`;
  }
  return null;
}

function getDefaultOrderView(orders: AdminOrder[]): {
  filter: OrderFilter;
  selectedId: string | null;
} {
  const approvalOrder = orders.find((order) => order.status === "pending_approval");
  if (approvalOrder) {
    return { filter: "needs_approval", selectedId: approvalOrder.id };
  }

  const activeOrder = orders.find((order) => activeStatuses.includes(order.status));
  if (activeOrder) {
    return { filter: "active", selectedId: activeOrder.id };
  }

  return { filter: "all", selectedId: orders[0]?.id ?? null };
}

function getAdminOrdersUrl(weeklyMenuId?: string) {
  return weeklyMenuId
    ? `/api/admin/orders?weeklyMenuId=${encodeURIComponent(weeklyMenuId)}`
    : "/api/admin/orders";
}

export function OrderDashboard({
  initialOrders,
  onOrdersChange,
  weeklyMenuId,
  weeklyMenuName,
}: {
  initialOrders: AdminOrder[];
  onOrdersChange?: (orders: AdminOrder[]) => void;
  weeklyMenuId?: string;
  weeklyMenuName?: string | null;
}) {
  const initialScopedOrders = weeklyMenuId
    ? initialOrders.filter((order) => order.weeklyMenuId === weeklyMenuId)
    : initialOrders;
  const initialView = getDefaultOrderView(initialScopedOrders);
  const [orders, setOrders] = useState<AdminOrder[]>(initialOrders);
  const [selectedId, setSelectedId] = useState<string | null>(initialView.selectedId);
  const [filter, setFilter] = useState<OrderFilter>(initialView.filter);
  const [moveWindowIds, setMoveWindowIds] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isWeekLoading, setIsWeekLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const detailsRef = useRef<HTMLDivElement>(null);
  const weekRequestIdRef = useRef(0);
  const currentWeeklyMenuIdRef = useRef(weeklyMenuId);

  const scopedOrders = useMemo(
    () =>
      weeklyMenuId
        ? orders.filter((order) => order.weeklyMenuId === weeklyMenuId)
        : orders,
    [orders, weeklyMenuId],
  );
  const filteredOrders = useMemo(
    () => scopedOrders.filter((order) => matchesOrderFilter(order, filter)),
    [filter, scopedOrders],
  );
  const selectedOrder =
    filteredOrders.find((order) => order.id === selectedId) ?? filteredOrders[0] ?? null;
  const openOrdersCount = scopedOrders.filter((order) =>
    activeStatuses.includes(order.status),
  ).length;
  const pendingPaymentCount = scopedOrders.filter(
    (order) => order.status === "pending_payment",
  ).length;
  const approvalCount = scopedOrders.filter(
    (order) => order.status === "pending_approval",
  ).length;
  const isInteractionPending = isPending || isWeekLoading;
  const statusActions = selectedOrder
    ? getAdminOrderStatusActions(selectedOrder.status, selectedOrder.source)
    : [];
  const canCompleteOrder = statusActions.some(
    (action) => action.status === "delivered",
  );
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

  useEffect(() => {
    currentWeeklyMenuIdRef.current = weeklyMenuId;
  }, [weeklyMenuId]);

  useEffect(() => {
    if (!weeklyMenuId) return;

    const requestId = ++weekRequestIdRef.current;
    const controller = new AbortController();

    async function loadSelectedWeekOrders() {
      await Promise.resolve();
      if (controller.signal.aborted || requestId !== weekRequestIdRef.current) {
        return;
      }
      setIsWeekLoading(true);
      setMessage(null);

      try {
        const response = await fetch(getAdminOrdersUrl(weeklyMenuId), {
          signal: controller.signal,
        });
        const payload = await readAdminJsonResponse(response);
        if (requestId !== weekRequestIdRef.current) return;

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["orders"]) ||
          !Array.isArray(payload.orders)
        ) {
          setMessage(
            getAdminPayloadError(payload) ||
              "Orders for this delivery week could not be loaded.",
          );
          return;
        }

        const nextOrders = payload.orders as AdminOrder[];
        const nextView = getDefaultOrderView(nextOrders);
        setOrders(nextOrders);
        onOrdersChange?.(nextOrders);
        setFilter(nextView.filter);
        setSelectedId(nextView.selectedId);
      } catch (error) {
        if (controller.signal.aborted || requestId !== weekRequestIdRef.current) {
          return;
        }
        setMessage(
          error instanceof Error && error.name === "AbortError"
            ? null
            : "Orders for this delivery week could not be loaded. Check your connection and try again.",
        );
      } finally {
        if (requestId === weekRequestIdRef.current) {
          setIsWeekLoading(false);
        }
      }
    }

    void loadSelectedWeekOrders();
    return () => controller.abort();
  }, [onOrdersChange, weeklyMenuId]);

  useEffect(() => {
    if (!message) return;
    const timeoutId = window.setTimeout(() => setMessage(null), 8_000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  function updateStatus(id: string, status: OrderStatus) {
    setMessage(null);
    const requestWeeklyMenuId = weeklyMenuId;
    startTransition(async () => {
      try {
        const response = await fetch(getAdminOrdersUrl(requestWeeklyMenuId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status }),
        });
        const payload = await readAdminJsonResponse(response);

        if (requestWeeklyMenuId !== currentWeeklyMenuIdRef.current) return;

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["orders"]) ||
          !Array.isArray(payload.orders)
        ) {
          setMessage(getAdminPayloadError(payload) || "Order could not be updated.");
          return;
        }

        const nextOrders = payload.orders as AdminOrder[];
        setOrders(nextOrders);
        onOrdersChange?.(nextOrders);
        if (status === "delivered") {
          const nextActiveOrder = nextOrders.find(
            (order) =>
              order.id !== id &&
              activeStatuses.includes(order.status) &&
              (!weeklyMenuId || order.weeklyMenuId === weeklyMenuId),
          );
          setFilter("active");
          setSelectedId(nextActiveOrder?.id ?? null);
        } else {
          setSelectedId(id);
          setFilter(activeStatuses.includes(status) ? "active" : status);
        }
        const completionNotification =
          hasAdminKeys(payload, ["completionNotification"]) &&
          typeof payload.completionNotification === "string"
            ? payload.completionNotification
            : null;
        setMessage(
          status !== "delivered"
            ? "Order updated."
            : getOrderCompletionMessage(completionNotification),
        );
      } catch {
        if (requestWeeklyMenuId !== currentWeeklyMenuIdRef.current) return;
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
    const requestWeeklyMenuId = weeklyMenuId;
    startTransition(async () => {
      try {
        const response = await fetch(getAdminOrdersUrl(requestWeeklyMenuId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action, targetDeliveryWindowId }),
        });
        const payload = await readAdminJsonResponse(response);

        if (requestWeeklyMenuId !== currentWeeklyMenuIdRef.current) return;

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["orders"]) ||
          !Array.isArray(payload.orders)
        ) {
          setMessage(getAdminPayloadError(payload) || "Approval request could not be updated.");
          return;
        }

        const nextOrders = payload.orders as AdminOrder[];
        setOrders(nextOrders);
        onOrdersChange?.(nextOrders);
        setSelectedId(id);
        setFilter(action === "deny_refund" ? "canceled" : "active");
        setMessage("Order updated.");
      } catch {
        if (requestWeeklyMenuId !== currentWeeklyMenuIdRef.current) return;
        setMessage("Approval request could not be updated. Check your connection and try again.");
      }
    });
  }

  function selectFilter(nextFilter: OrderFilter) {
    setFilter(nextFilter);
    setSelectedId(
      scopedOrders.find((order) => matchesOrderFilter(order, nextFilter))?.id ??
        null,
    );
    setMessage(null);
  }

  function confirmStatusUpdate(order: AdminOrder, status: OrderStatus) {
    const confirmation = getOrderStatusUpdateConfirmation(order, status);
    return confirmation ? window.confirm(confirmation) : true;
  }

  function revealOrderDetailsOnMobile() {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    window.requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      detailsRef.current?.focus({ preventScroll: true });
    });
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
            Review approval requests and track paid orders through baking, delivery,
            and completion{weeklyMenuName ? ` for ${weeklyMenuName}` : ""}.
          </p>
        </div>
        <div className="rounded-md border border-stone-200 bg-[#fffaf2] px-3 py-2 text-sm font-semibold text-stone-700">
          {approvalCount} need approval - {openOrdersCount} active - {pendingPaymentCount} unpaid
        </div>
      </div>

      {message ? (
        <div
          role={isOrderSuccessMessage(message) ? "status" : "alert"}
          aria-atomic="true"
          aria-live={isOrderSuccessMessage(message) ? "polite" : "assertive"}
          className={`fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-center gap-2 rounded-md border bg-white px-4 py-3 text-sm font-semibold shadow-lg ${
            isOrderSuccessMessage(message)
              ? "border-emerald-200 text-emerald-800"
              : "border-red-200 text-[#a94334]"
          }`}
        >
          {isOrderSuccessMessage(message) ? (
            <CheckCircle2 className="shrink-0" size={16} />
          ) : null}
          <span>{message}</span>
          <button
            type="button"
            className="ml-auto shrink-0 rounded-sm px-2 py-1 text-xs font-bold underline underline-offset-2"
            onClick={() => setMessage(null)}
            aria-label="Dismiss order message"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {filterOptions.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filter === status}
            onClick={() => selectFilter(status)}
            disabled={isInteractionPending}
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
          {isWeekLoading ? (
            <div
              role="status"
              className="inline-flex items-center gap-2 rounded-md border border-stone-200 bg-[#fffaf2] p-5 text-sm font-semibold text-stone-700"
            >
              <Loader2 className="animate-spin" size={16} />
              Loading this Sunday&apos;s orders...
            </div>
          ) : null}

          {!isWeekLoading ? filteredOrders.map((order) => (
            <button
              key={order.id}
              type="button"
              disabled={isInteractionPending}
              aria-pressed={selectedOrder?.id === order.id}
              onClick={() => {
                setSelectedId(order.id);
                setMessage(null);
                revealOrderDetailsOnMobile();
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
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <span>{formatDate(order.createdAt)}</span>
                    {order.source === "bread_club" ? (
                      <span className="rounded-sm bg-[#23443b] px-1.5 py-0.5 font-semibold text-white">
                        Bread Club
                      </span>
                    ) : null}
                    {order.source === "bread_club_addon" ? (
                      <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-950">
                        Club add-on
                      </span>
                    ) : null}
                  </div>
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
          )) : null}

          {!isWeekLoading && !filteredOrders.length ? (
            <div className="rounded-md border border-dashed border-stone-300 bg-[#fffaf2] p-5 text-sm text-stone-700">
              No orders match this status yet.
            </div>
          ) : null}
        </div>

        <div
          ref={detailsRef}
          tabIndex={-1}
          className="scroll-mt-24 rounded-md border border-stone-100 bg-[#fffaf2] p-4 outline-none"
        >
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
                  {selectedOrder.source !== "storefront" ? (
                    <p className="mt-1 text-sm font-semibold text-[#23443b]">
                      {selectedOrder.source === "bread_club"
                        ? "Bread Club Sunday delivery"
                        : "Bread Club add-on"}
                    </p>
                  ) : null}
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
                    paid.
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
                        {selectedOrder.approvalRefundStartedAt
                          ? "Stripe refund is in progress"
                          : "Paid same-week request needs a decision"}
                      </p>
                      <p className="mt-1">
                        {selectedOrder.approvalRefundStartedAt
                          ? "Acceptance and moving are locked so this paid order cannot be reserved while Stripe is refunding it. Use Check refund status to finish the cancellation when Stripe confirms success."
                          : "Accepting reserves this Sunday&apos;s inventory and delivery spot. Denying refunds the Stripe payment. Moving to next Sunday is only available if the customer said next Sunday works."}
                      </p>
                      <p className="mt-1 font-semibold text-stone-950">
                        Next Sunday works: {selectedOrder.nextWeekOk ? "Yes" : "No"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button
                      type="button"
                      disabled={
                        isInteractionPending ||
                        Boolean(selectedOrder.approvalRefundStartedAt)
                      }
                      onClick={() => runApprovalAction(selectedOrder.id, "accept_request")}
                    >
                      {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
                      Accept request
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isInteractionPending}
                      onClick={() => {
                        if (
                          selectedOrder.approvalRefundStartedAt ||
                          window.confirm(
                            `Deny and refund ${formatCurrency(selectedOrder.totalCents)} to ${selectedOrder.customerName}?`,
                          )
                        ) {
                          runApprovalAction(selectedOrder.id, "deny_refund");
                        }
                      }}
                    >
                      {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
                      {selectedOrder.approvalRefundStartedAt
                        ? "Check refund status"
                        : "Deny & refund"}
                    </Button>
                  </div>
                  {selectedOrder.nextWeekOk &&
                  !selectedOrder.approvalRefundStartedAt ? (
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
                          disabled={
                            isInteractionPending || !selectedOrder.moveWindows.length
                          }
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
                        disabled={
                          isInteractionPending || !selectedOrder.moveWindows.length
                        }
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
                    This order is canceled. It cannot be restored with a raw status change;
                    use Stripe reconciliation or create a new verified order instead.
                  </p>
                </div>
              ) : null}

              {statusActions.length ? (
                <div className="mt-4 rounded-md border border-[#23443b]/25 bg-white p-4">
                  <div>
                    <p className="font-semibold text-stone-950">
                      {selectedOrder.status === "delivered"
                        ? "Order complete"
                        : canCompleteOrder
                          ? "Finish this order"
                          : "Order actions"}
                    </p>
                    {canCompleteOrder ? (
                      <p className="mt-1 text-sm leading-6 text-stone-600">
                        Already delivered? Complete it here in one click. This marks it
                        delivered, safely queues the thank-you email with its review link,
                        and moves it from Active to Completed.
                      </p>
                    ) : selectedOrder.status === "delivered" ? (
                      <p className="mt-1 text-sm leading-6 text-stone-600">
                        This order is complete and no longer appears in Active.
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
                        disabled={isInteractionPending}
                        onClick={() => {
                          if (confirmStatusUpdate(selectedOrder, action.status)) {
                            updateStatus(selectedOrder.id, action.status);
                          }
                        }}
                      >
                        {isPending ? (
                          <Loader2 className="animate-spin" size={16} />
                        ) : action.status === "delivered" ? (
                          <CheckCircle2 size={16} />
                        ) : null}
                        {action.label}
                      </Button>
                    ))}
                  </div>
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
                <div className="flex justify-between">
                  <span>Sales tax</span>
                  <span>{formatCurrency(selectedOrder.taxCents)}</span>
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
