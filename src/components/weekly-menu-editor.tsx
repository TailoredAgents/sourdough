"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import type { Product, WeeklyMenu } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";

type MenuItemForm = {
  productId: string;
  included: boolean;
  availableQuantity: number;
  soldQuantity: number;
  featured: boolean;
};

type WeeklyMenuForm = {
  id: string;
  name: string;
  orderCutoffAt: string;
  startsAt: string;
  endsAt: string;
  published: boolean;
  items: MenuItemForm[];
};

function toLocalInputValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function buildForm(weeklyMenu: WeeklyMenu, products: Product[]): WeeklyMenuForm {
  return {
    id: weeklyMenu.id,
    name: weeklyMenu.name,
    orderCutoffAt: toLocalInputValue(weeklyMenu.orderCutoffAt),
    startsAt: toLocalInputValue(weeklyMenu.startsAt),
    endsAt: toLocalInputValue(weeklyMenu.endsAt),
    published: weeklyMenu.published,
    items: products.map((product) => {
      const existing = weeklyMenu.items.find((item) => item.productId === product.id);
      return {
        productId: product.id,
        included: Boolean(existing),
        availableQuantity: existing?.availableQuantity ?? 0,
        soldQuantity: existing?.soldQuantity ?? 0,
        featured: existing?.featured ?? false,
      };
    }),
  };
}

export function WeeklyMenuEditor({
  initialWeeklyMenu,
  products,
}: {
  initialWeeklyMenu: WeeklyMenu | null;
  products: Product[];
}) {
  const fallbackWeeklyMenu = useMemo<WeeklyMenu>(
    () =>
      initialWeeklyMenu ?? {
        id: "",
        name: "Weekly Bake Drop",
        orderCutoffAt: new Date().toISOString(),
        startsAt: new Date().toISOString(),
        endsAt: new Date().toISOString(),
        published: true,
        items: [],
      },
    [initialWeeklyMenu],
  );
  const [form, setForm] = useState(() => buildForm(fallbackWeeklyMenu, products));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateItem(productId: string, patch: Partial<MenuItemForm>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.productId === productId ? { ...item, ...patch } : item,
      ),
    }));
  }

  function saveWeeklyMenu() {
    setMessage(null);

    if (!form.id) {
      setMessage("No published weekly menu exists yet.");
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/admin/weekly-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          name: form.name,
          orderCutoffAt: fromLocalInputValue(form.orderCutoffAt),
          startsAt: fromLocalInputValue(form.startsAt),
          endsAt: fromLocalInputValue(form.endsAt),
          published: form.published,
          items: form.items,
        }),
      });
      const payload = (await response.json()) as {
        weeklyMenu?: WeeklyMenu;
        error?: string;
      };

      if (!response.ok || !payload.weeklyMenu) {
        setMessage(payload.error || "Weekly menu could not be saved.");
        return;
      }

      setForm(buildForm(payload.weeklyMenu, products));
      setMessage("Weekly menu saved.");
    });
  }

  return (
    <section className="mt-8 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-xl font-bold text-stone-950">Weekly menu builder</h2>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Choose products for the active bake drop and set sellable inventory.
          </p>
        </div>
        <Button type="button" onClick={saveWeeklyMenu} disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          Save weekly menu
        </Button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_180px_180px_140px]">
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Menu name
          <input
            className="h-11 rounded-md border border-stone-300 px-3 font-normal"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Cutoff
          <input
            className="h-11 rounded-md border border-stone-300 px-3 font-normal"
            type="datetime-local"
            value={form.orderCutoffAt}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                orderCutoffAt: event.target.value,
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Starts
          <input
            className="h-11 rounded-md border border-stone-300 px-3 font-normal"
            type="datetime-local"
            value={form.startsAt}
            onChange={(event) =>
              setForm((current) => ({ ...current, startsAt: event.target.value }))
            }
          />
        </label>
        <label className="flex items-end gap-2 pb-3 text-sm font-semibold text-stone-700">
          <input
            type="checkbox"
            checked={form.published}
            onChange={(event) =>
              setForm((current) => ({ ...current, published: event.target.checked }))
            }
          />
          Published
        </label>
      </div>

      <label className="mt-3 grid max-w-xs gap-1 text-sm font-semibold text-stone-700">
        Ends
        <input
          className="h-11 rounded-md border border-stone-300 px-3 font-normal"
          type="datetime-local"
          value={form.endsAt}
          onChange={(event) =>
            setForm((current) => ({ ...current, endsAt: event.target.value }))
          }
        />
      </label>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="py-3">Include</th>
              <th className="py-3">Product</th>
              <th className="py-3">Price</th>
              <th className="py-3">Available</th>
              <th className="py-3">Sold</th>
              <th className="py-3">Featured</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {products.map((product) => {
              const item = form.items.find((entry) => entry.productId === product.id);
              if (!item) return null;

              return (
                <tr key={product.id}>
                  <td className="py-3">
                    <input
                      type="checkbox"
                      checked={item.included}
                      onChange={(event) =>
                        updateItem(product.id, { included: event.target.checked })
                      }
                    />
                  </td>
                  <td className="py-3">
                    <p className="font-semibold text-stone-950">{product.name}</p>
                    <p className="text-xs uppercase tracking-wide text-stone-500">
                      {product.category}
                    </p>
                  </td>
                  <td className="py-3 text-stone-700">
                    {formatCurrency(product.priceCents)}
                  </td>
                  <td className="py-3">
                    <input
                      className="h-10 w-24 rounded-md border border-stone-300 px-3"
                      min={0}
                      type="number"
                      value={item.availableQuantity}
                      onChange={(event) =>
                        updateItem(product.id, {
                          availableQuantity: Number(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="py-3">
                    <input
                      className="h-10 w-24 rounded-md border border-stone-300 px-3"
                      min={0}
                      type="number"
                      value={item.soldQuantity}
                      onChange={(event) =>
                        updateItem(product.id, {
                          soldQuantity: Number(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="checkbox"
                      checked={item.featured}
                      onChange={(event) =>
                        updateItem(product.id, { featured: event.target.checked })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {message ? (
        <p
          className={`mt-4 inline-flex items-center gap-2 text-sm font-semibold ${
            message === "Weekly menu saved." ? "text-emerald-800" : "text-[#a94334]"
          }`}
        >
          {message === "Weekly menu saved." ? <CheckCircle2 size={16} /> : null}
          {message}
        </p>
      ) : null}
    </section>
  );
}
