"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Loader2, Save } from "lucide-react";
import type { Product, WeeklyMenu, WeeklyMenuSummary } from "@/lib/types";
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
  initialWeeklyMenus,
  onSelectedWeeklyMenuIdChange,
  onWeeklyMenusChange,
  products,
  selectedWeeklyMenuId,
}: {
  initialWeeklyMenu: WeeklyMenu | null;
  initialWeeklyMenus: WeeklyMenuSummary[];
  onSelectedWeeklyMenuIdChange: (id: string) => void;
  onWeeklyMenusChange: (menus: WeeklyMenuSummary[]) => void;
  products: Product[];
  selectedWeeklyMenuId: string;
}) {
  const router = useRouter();
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
  const [weeklyMenus, setWeeklyMenus] = useState(initialWeeklyMenus);
  const [isUnsavedClone, setIsUnsavedClone] = useState(false);
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

  function cloneAsNewMenu() {
    setMessage("Cloned current menu. Adjust dates, then save to create it.");
    setIsUnsavedClone(true);
    setForm((current) => {
      const startsAt = current.startsAt ? new Date(current.startsAt) : new Date();
      const endsAt = current.endsAt ? new Date(current.endsAt) : new Date();
      const cutoffAt = current.orderCutoffAt
        ? new Date(current.orderCutoffAt)
        : new Date();
      startsAt.setDate(startsAt.getDate() + 7);
      endsAt.setDate(endsAt.getDate() + 7);
      cutoffAt.setDate(cutoffAt.getDate() + 7);
      return {
        ...current,
        id: "",
        name: `${current.name} Copy`,
        startsAt: toLocalInputValue(startsAt.toISOString()),
        endsAt: toLocalInputValue(endsAt.toISOString()),
        orderCutoffAt: toLocalInputValue(cutoffAt.toISOString()),
        items: current.items.map((item) => ({ ...item, soldQuantity: 0 })),
      };
    });
  }

  function selectWeeklyMenu(id: string) {
    if (!id || id === "unsaved-clone") return;
    setMessage(null);
    setIsUnsavedClone(false);
    onSelectedWeeklyMenuIdChange(id);
    startTransition(async () => {
      const response = await fetch(`/api/admin/weekly-menu?id=${encodeURIComponent(id)}`);
      const payload = (await response.json()) as {
        weeklyMenus?: WeeklyMenuSummary[];
        selectedWeeklyMenu?: WeeklyMenu | null;
        error?: string;
      };

      if (!response.ok || !payload.selectedWeeklyMenu) {
        setMessage(payload.error || "Weekly menu could not be loaded.");
        return;
      }

      if (payload.weeklyMenus) {
        setWeeklyMenus(payload.weeklyMenus);
        onWeeklyMenusChange(payload.weeklyMenus);
      }
      setForm(buildForm(payload.selectedWeeklyMenu, products));
    });
  }

  function saveWeeklyMenu() {
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/admin/weekly-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          name: form.name,
          orderCutoffAt: fromLocalInputValue(form.orderCutoffAt),
          startsAt: fromLocalInputValue(form.startsAt),
          endsAt: fromLocalInputValue(form.endsAt),
          published: form.published,
          items: form.items,
        }),
      });
      const payload = (await response.json()) as {
        weeklyMenus?: WeeklyMenuSummary[];
        selectedWeeklyMenu?: WeeklyMenu | null;
        error?: string;
      };

      if (!response.ok || !payload.selectedWeeklyMenu) {
        setMessage(payload.error || "Weekly menu could not be saved.");
        return;
      }

      if (payload.weeklyMenus) {
        setWeeklyMenus(payload.weeklyMenus);
        onWeeklyMenusChange(payload.weeklyMenus);
      }
      onSelectedWeeklyMenuIdChange(payload.selectedWeeklyMenu.id);
      setIsUnsavedClone(false);
      setForm(buildForm(payload.selectedWeeklyMenu, products));
      setMessage("Weekly menu saved.");
      router.refresh();
    });
  }

  return (
    <section id="weekly-menu" className="mt-8 scroll-mt-28 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-xl font-bold text-stone-950">Weekly menu builder</h2>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Choose products for the active bake drop and set sellable inventory.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={saveWeeklyMenu} disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            {form.id ? "Save weekly menu" : "Create weekly menu"}
          </Button>
          <Button type="button" variant="secondary" onClick={cloneAsNewMenu}>
            <Copy size={16} />
            Clone as new
          </Button>
        </div>
      </div>

      <label className="mt-5 grid gap-1 text-sm font-semibold text-stone-700">
        Edit bake drop
        <select
          className="h-11 rounded-md border border-stone-300 bg-white px-3 font-normal"
          value={isUnsavedClone ? "unsaved-clone" : form.id || selectedWeeklyMenuId || ""}
          onChange={(event) => selectWeeklyMenu(event.target.value)}
          disabled={isPending || !weeklyMenus.length}
        >
          {!weeklyMenus.length ? <option value="">No menus yet</option> : null}
          {isUnsavedClone ? (
            <option value="unsaved-clone">Unsaved cloned menu</option>
          ) : null}
          {weeklyMenus.map((menu) => (
            <option key={menu.id} value={menu.id}>
              {menu.name} - {menu.published ? "published" : "draft"} - {menu.itemCount} items
            </option>
          ))}
        </select>
      </label>

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

      <div className="mt-5 overflow-hidden rounded-md border border-stone-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-stone-200 bg-[#fffaf2] text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Include</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Available</th>
                <th className="px-4 py-3">Sold</th>
                <th className="px-4 py-3">Featured</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {products.map((product) => {
                const item = form.items.find((entry) => entry.productId === product.id);
                if (!item) return null;

                return (
                  <tr key={product.id}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={item.included}
                        onChange={(event) =>
                          updateItem(product.id, { included: event.target.checked })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-stone-950">{product.name}</p>
                      <p className="text-xs uppercase tracking-wide text-stone-500">
                        {product.category}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-stone-700">
                      {formatCurrency(product.priceCents)}
                    </td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3">
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
