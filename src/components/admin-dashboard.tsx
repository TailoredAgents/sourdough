"use client";

import { useState, useTransition } from "react";
import {
  Bot,
  ClipboardList,
  Inbox,
  Loader2,
  Megaphone,
  Package,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { DeliverySettings } from "@/lib/delivery";
import type {
  AiKnowledgeEntry,
  CustomerMessage,
  DeliveryWindow,
  MenuProduct,
  Product,
  WeeklyMenu,
  AdminOrder,
} from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { AiKnowledgeEditor } from "./ai-knowledge-editor";
import { Button } from "./button";
import { CustomerMessageInbox } from "./customer-message-inbox";
import { DeliveryEditor } from "./delivery-editor";
import { OrderDashboard } from "./order-dashboard";
import { ProductEditor } from "./product-editor";
import { WeeklyMenuEditor } from "./weekly-menu-editor";

export function AdminDashboard({
  aiKnowledgeEntries,
  customerMessages,
  deliverySettings,
  deliveryWindows,
  menu,
  orders,
  products,
  weeklyMenu,
}: {
  aiKnowledgeEntries: AiKnowledgeEntry[];
  customerMessages: CustomerMessage[];
  deliverySettings: DeliverySettings;
  deliveryWindows: DeliveryWindow[];
  menu: MenuProduct[];
  orders: AdminOrder[];
  products: Product[];
  weeklyMenu: WeeklyMenu | null;
}) {
  const [draftType, setDraftType] = useState("weekly_announcement");
  const [context, setContext] = useState(
    "Announce this week's classic country loaf, rosemary garlic loaf, and honey butter. Mention Thursday cutoff.",
  );
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const openRequestCount = customerMessages.filter(
    (message) => message.status === "new" || message.status === "in_progress",
  ).length;
  const openOrderCount = orders.filter((order) =>
    ["paid", "baking", "out_for_delivery"].includes(order.status),
  ).length;
  const stats: { label: string; value: string; Icon: LucideIcon }[] = [
    { label: "Open orders", value: String(openOrderCount), Icon: ClipboardList },
    { label: "Customer requests", value: String(openRequestCount), Icon: Inbox },
    { label: "Bake capacity", value: "28 loaves", Icon: Package },
    { label: "Delivery windows", value: String(deliveryWindows.length), Icon: Truck },
  ];

  function generateDraft() {
    startTransition(async () => {
      const response = await fetch("/api/admin/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: draftType, context }),
      });
      const payload = (await response.json()) as { draft: string };
      setDraft(payload.draft);
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
              L&L Sourdough admin
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-700">
              This is the v1 operating console. It is demo-backed locally and
              ready to connect to Supabase Auth and database tables.
            </p>
          </div>
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            Add Supabase Auth before live launch
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

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
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

          <div className="rounded-md border border-stone-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Megaphone className="text-[#a94334]" size={20} />
              <h2 className="text-xl font-bold text-stone-950">AI drafting assistant</h2>
            </div>
            <p className="mt-1 text-sm text-stone-700">
              Drafts must be reviewed and edited before sending to customers.
            </p>
            <div className="mt-5 grid gap-3">
              <select
                className="h-11 rounded-md border border-stone-300 px-3 text-sm"
                value={draftType}
                onChange={(event) => setDraftType(event.target.value)}
              >
                <option value="weekly_announcement">Weekly announcement</option>
                <option value="product_description">Product description</option>
                <option value="customer_reply">Customer reply</option>
                <option value="order_summary">Order summary</option>
              </select>
              <textarea
                className="min-h-28 rounded-md border border-stone-300 p-3 text-sm"
                value={context}
                onChange={(event) => setContext(event.target.value)}
              />
              <Button type="button" onClick={generateDraft} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" size={16} /> : <Bot size={16} />}
                Generate draft
              </Button>
              <textarea
                className="min-h-52 rounded-md border border-stone-300 bg-[#fffaf2] p-3 text-sm leading-6"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Generated draft appears here for editing."
              />
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

        <WeeklyMenuEditor initialWeeklyMenu={weeklyMenu} products={products} />

        <OrderDashboard initialOrders={orders} />

        <CustomerMessageInbox initialMessages={customerMessages} />

        <AiKnowledgeEditor initialEntries={aiKnowledgeEntries} />

        <DeliveryEditor
          initialDeliverySettings={deliverySettings}
          initialDeliveryWindows={deliveryWindows}
        />

        <ProductEditor initialProducts={products} />
      </main>
    </div>
  );
}
