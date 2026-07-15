"use client";

import { useState, useTransition } from "react";
import {
  Bot,
  ClipboardList,
  Copy,
  Inbox,
  Loader2,
  Megaphone,
  Package,
  Truck,
  type LucideIcon,
  MailCheck,
} from "lucide-react";
import {
  extractAdminDraftText,
  validateAdminDraftInput,
} from "@/lib/admin-draft";
import {
  extractAdminEmailTestResult,
  summarizeAdminEmailTest,
} from "@/lib/admin-email-test";
import type { DeliverySettings } from "@/lib/delivery";
import type {
  AiKnowledgeEntry,
  CustomerMessage,
  DeliveryWindow,
  MenuProduct,
  Product,
  WeeklyMenu,
  AdminOrder,
  WeeklyMenuSummary,
} from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { AiKnowledgeEditor } from "./ai-knowledge-editor";
import { Button } from "./button";
import { CustomerMessageInbox } from "./customer-message-inbox";
import { DeliveryEditor } from "./delivery-editor";
import { OrderDashboard } from "./order-dashboard";
import { ProductEditor } from "./product-editor";
import { WeeklyMenuEditor } from "./weekly-menu-editor";

const activeOrderStatuses = ["paid", "baking", "out_for_delivery"] as const;

export function AdminDashboard({
  aiKnowledgeEntries,
  customerMessages,
  deliverySettings,
  deliveryWindows,
  menu,
  orders,
  products,
  weeklyMenu,
  weeklyMenus,
}: {
  aiKnowledgeEntries: AiKnowledgeEntry[];
  customerMessages: CustomerMessage[];
  deliverySettings: DeliverySettings;
  deliveryWindows: DeliveryWindow[];
  menu: MenuProduct[];
  orders: AdminOrder[];
  products: Product[];
  weeklyMenu: WeeklyMenu | null;
  weeklyMenus: WeeklyMenuSummary[];
}) {
  const [weeklyMenusState, setWeeklyMenusState] = useState(weeklyMenus);
  const [selectedWeeklyMenuId, setSelectedWeeklyMenuId] = useState(
    weeklyMenu?.id ?? weeklyMenus[0]?.id ?? "",
  );
  const [draftType, setDraftType] = useState("weekly_announcement");
  const [context, setContext] = useState(
    "Announce this week's featured bake drop. Mention the posted order cutoff and delivery ZIPs.",
  );
  const [draft, setDraft] = useState("");
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [emailTestMessage, setEmailTestMessage] = useState<string | null>(null);
  const [isDraftPending, startDraftTransition] = useTransition();
  const [isEmailTestPending, startEmailTestTransition] = useTransition();
  const openRequestCount = customerMessages.filter(
    (message) => message.status === "new" || message.status === "in_progress",
  ).length;
  const newRequestCount = customerMessages.filter((message) => message.status === "new").length;
  const openOrderCount = orders.filter((order) =>
    activeOrderStatuses.includes(order.status as (typeof activeOrderStatuses)[number]),
  ).length;
  const pendingPaymentCount = orders.filter((order) => order.status === "pending_payment").length;
  const paidOrderCount = orders.filter((order) => order.status === "paid").length;
  const approvedKnowledgeCount = aiKnowledgeEntries.filter((entry) => entry.approved).length;
  const menuCapacity = menu.reduce((sum, item) => sum + item.availableQuantity, 0);
  const soldCount = menu.reduce((sum, item) => sum + item.soldQuantity, 0);
  const remainingCount = menu.reduce((sum, item) => sum + item.remainingQuantity, 0);
  const stats: { label: string; value: string; Icon: LucideIcon }[] = [
    { label: "Active paid orders", value: String(openOrderCount), Icon: ClipboardList },
    { label: "Open requests", value: String(openRequestCount), Icon: Inbox },
    { label: "Loaves/items left", value: String(remainingCount), Icon: Package },
    { label: "Delivery windows", value: String(deliveryWindows.length), Icon: Truck },
  ];
  const quickLinks = [
    { label: "Orders", href: "#orders", count: openOrderCount },
    { label: "Requests", href: "#requests", count: openRequestCount },
    { label: "Weekly menu", href: "#weekly-menu", count: remainingCount },
    { label: "Delivery", href: "#delivery", count: deliveryWindows.length },
    { label: "Products", href: "#products", count: products.length },
    { label: "Drafts", href: "#assistant", count: "AI" },
    { label: "Knowledge", href: "#knowledge", count: approvedKnowledgeCount },
  ].map((link) => ({ ...link, count: String(link.count) }));

  function generateDraft() {
    setDraftMessage(null);
    const validationMessage = validateAdminDraftInput({ type: draftType, context });
    if (validationMessage) {
      setDraftMessage(validationMessage);
      return;
    }

    startDraftTransition(async () => {
      try {
        const response = await fetch("/api/admin/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: draftType, context: context.trim() }),
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        const nextDraft = extractAdminDraftText(payload);

        if (!response.ok || !nextDraft) {
          setDraftMessage("Draft could not be generated. Check admin access and try again.");
          return;
        }

        setDraft(nextDraft);
        setDraftMessage("Draft generated for review.");
      } catch {
        setDraftMessage("Draft could not be generated. Check your connection and try again.");
      }
    });
  }

  async function copyDraft() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setDraftMessage("Draft copied.");
    } catch {
      setDraftMessage("Draft could not be copied. Select the text and copy it manually.");
    }
  }

  function sendEmailTest() {
    setEmailTestMessage(null);
    startEmailTestTransition(async () => {
      try {
        const response = await fetch("/api/admin/email-test", {
          method: "POST",
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        const result = extractAdminEmailTestResult(payload);

        if (!response.ok || !result) {
          const error =
            payload && typeof payload === "object"
              ? (payload as { error?: unknown }).error
              : null;
          setEmailTestMessage(
            typeof error === "string"
              ? error
              : "Test email could not be sent. Check email configuration and try again.",
          );
          return;
        }

        setEmailTestMessage(summarizeAdminEmailTest(result));
      } catch {
        setEmailTestMessage(
          "Test email could not be sent. Check your connection and try again.",
        );
      }
    });
  }

  return (
    <div className="min-h-screen bg-[#fffaf2]">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
              Owner workspace
            </p>
            <h1 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
              Luna &amp; Lorelai&apos;s Sourdough admin
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-700">
              This is the v1 operating console for menu, delivery, orders,
              customer requests, and approved AI knowledge.
            </p>
          </div>
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            Drafts and order status changes should be reviewed before sending
          </div>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-4">
          {stats.map(({ label, value, Icon }) => (
            <div key={label} className="rounded-md border border-stone-200 bg-white p-4">
              <Icon className="text-[#a94334]" size={20} />
              <p className="mt-3 text-sm text-stone-600">{label}</p>
              <p className="mt-1 text-2xl font-bold text-stone-950">{value}</p>
            </div>
          ))}
        </section>

        <nav
          aria-label="Admin sections"
          className="sticky top-0 z-30 -mx-4 mt-6 overflow-x-auto border-y border-stone-200 bg-[#fffaf2]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        >
          <div className="flex min-w-max gap-2">
            {quickLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold text-stone-800 transition hover:bg-stone-50"
              >
                {link.label}
                <span className="rounded-sm bg-[#f7efe3] px-2 py-0.5 text-xs text-[#23443b]">
                  {link.count}
                </span>
              </a>
            ))}
          </div>
        </nav>

        <section className="mt-6 grid gap-4 lg:grid-cols-4">
          <div className="rounded-md border border-[#23443b]/20 bg-white p-4">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#23443b]">
              Work queue
            </p>
            <p className="mt-2 text-2xl font-bold text-stone-950">
              {openOrderCount + openRequestCount} needs attention
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              {paidOrderCount} paid orders ready to work, {newRequestCount} new
              requests, and {pendingPaymentCount} unpaid checkouts.
            </p>
          </div>
          <div className="rounded-md border border-stone-200 bg-white p-4">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#a94334]">
              Bake status
            </p>
            <p className="mt-2 text-2xl font-bold text-stone-950">
              {soldCount} sold / {menuCapacity} capacity
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              {remainingCount} items remain available on the customer storefront.
            </p>
          </div>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <p className="font-bold">Owner reminder</p>
            <p className="mt-1">
              Work paid orders first. Pending payment orders are not confirmed
              until Stripe marks them paid.
            </p>
          </div>
          <div className="rounded-md border border-stone-200 bg-white p-4">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#23443b]">
              Alert test
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              Send a production email and owner alert test.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={sendEmailTest}
              disabled={isEmailTestPending}
            >
              {isEmailTestPending ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <MailCheck size={16} />
              )}
              Send test
            </Button>
            {emailTestMessage ? (
              <p
                className={`mt-3 text-sm font-semibold ${
                  emailTestMessage.startsWith("Test email sent")
                    ? "text-emerald-800"
                    : "text-[#a94334]"
                }`}
              >
                {emailTestMessage}
              </p>
            ) : null}
          </div>
        </section>

        <OrderDashboard initialOrders={orders} />

        <CustomerMessageInbox initialMessages={customerMessages} />

        <section id="menu-summary" className="mt-8 scroll-mt-28 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-md border border-stone-200 bg-white p-5">
            <h2 className="text-xl font-bold text-stone-950">Weekly menu control</h2>
            <p className="mt-1 text-sm text-stone-700">
              Inventory limits stop checkout when a bake drop sells out.
            </p>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-3">Product</th>
                    <th className="py-3">Category</th>
                    <th className="py-3">Price</th>
                    <th className="py-3">Sold</th>
                    <th className="py-3">Limit</th>
                    <th className="py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {menu.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 font-semibold text-stone-950">{item.name}</td>
                      <td className="py-3 text-stone-700">{item.category}</td>
                      <td className="py-3 text-stone-700">{formatCurrency(item.priceCents)}</td>
                      <td className="py-3 text-stone-700">{item.soldQuantity}</td>
                      <td className="py-3 text-stone-700">{item.availableQuantity}</td>
                      <td className="py-3">
                        <span className="rounded-sm bg-emerald-50 px-2 py-1 text-xs font-bold uppercase text-emerald-800">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div id="assistant" className="scroll-mt-28 rounded-md border border-stone-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Megaphone className="text-[#a94334]" size={20} />
              <h2 className="text-xl font-bold text-stone-950">AI drafting assistant</h2>
            </div>
            <p className="mt-1 text-sm text-stone-700">
              Draft only. Review, edit, and copy before sending anywhere.
            </p>
            <div className="mt-5 grid gap-3">
              <select
                className="h-11 rounded-md border border-stone-300 px-3 text-sm"
                aria-label="Draft type"
                value={draftType}
                onChange={(event) => setDraftType(event.target.value)}
                disabled={isDraftPending}
              >
                <option value="weekly_announcement">Weekly announcement</option>
                <option value="product_description">Product description</option>
                <option value="customer_reply">Customer reply</option>
                <option value="order_summary">Order summary</option>
              </select>
              <textarea
                className="min-h-28 rounded-md border border-stone-300 p-3 text-sm"
                aria-label="Draft context"
                value={context}
                onChange={(event) => setContext(event.target.value)}
                maxLength={2000}
              />
              <Button
                type="button"
                onClick={generateDraft}
                disabled={isDraftPending || !context.trim()}
              >
                {isDraftPending ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Bot size={16} />
                )}
                Generate draft
              </Button>
              <textarea
                className="min-h-52 rounded-md border border-stone-300 bg-[#fffaf2] p-3 text-sm leading-6"
                aria-label="Generated draft"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Generated draft appears here for editing."
              />
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={copyDraft}
                  disabled={isDraftPending || !draft}
                >
                  <Copy size={16} />
                  Copy draft
                </Button>
                {draftMessage ? (
                  <span className="text-sm font-semibold text-stone-700">
                    {draftMessage}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-md border border-stone-200 bg-white p-5">
            <h2 className="text-xl font-bold text-stone-950">Product catalog</h2>
            <div className="mt-4 grid gap-3">
              {products.map((product) => (
                <div key={product.id} className="rounded-md border border-stone-100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-stone-950">{product.name}</p>
                    <p className="text-sm font-bold text-[#23443b]">
                      {formatCurrency(product.priceCents)}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-stone-700">{product.description}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-stone-200 bg-white p-5">
            <h2 className="text-xl font-bold text-stone-950">Delivery windows</h2>
            <div className="mt-4 grid gap-3">
              {deliveryWindows.map((window) => (
                <div key={window.id} className="rounded-md border border-stone-100 p-3">
                  <p className="font-semibold text-stone-950">{window.label}</p>
                  <p className="mt-1 text-sm text-stone-700">
                    {window.capacity - window.reserved} of {window.capacity} spots remain
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <WeeklyMenuEditor
          initialWeeklyMenu={weeklyMenu}
          initialWeeklyMenus={weeklyMenusState}
          onSelectedWeeklyMenuIdChange={setSelectedWeeklyMenuId}
          onWeeklyMenusChange={setWeeklyMenusState}
          products={products}
          selectedWeeklyMenuId={selectedWeeklyMenuId}
        />

        <AiKnowledgeEditor initialEntries={aiKnowledgeEntries} />

        <DeliveryEditor
          initialDeliverySettings={deliverySettings}
          initialDeliveryWindows={deliveryWindows}
          onSelectedWeeklyMenuIdChange={setSelectedWeeklyMenuId}
          selectedWeeklyMenuId={selectedWeeklyMenuId}
          weeklyMenus={weeklyMenusState}
        />

        <ProductEditor
          currentMenuProductIds={menu.map((item) => item.id)}
          initialProducts={products}
        />
      </main>
    </div>
  );
}
