"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Loader2, Save } from "lucide-react";
import {
  getAdminPayloadError,
  hasAdminKeys,
  readAdminJsonResponse,
} from "@/lib/admin-api";
import { validateWeeklyMenuForm } from "@/lib/admin-form-validation";
import { isWeeklyMenuItemUnavailable } from "@/lib/menu-availability";
import type { Product, WeeklyMenu, WeeklyMenuSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";

type MenuItemForm = {
  productId: string;
  included: boolean;
  availableQuantity: number;
  soldQuantity: number;
  featured: boolean;
  unavailable: boolean;
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
      const unavailable = existing
        ? Boolean(existing.unavailable) || isWeeklyMenuItemUnavailable(existing)
        : false;
      return {
        productId: product.id,
        included: Boolean(existing),
        availableQuantity: existing?.availableQuantity ?? 0,
        soldQuantity: existing?.soldQuantity ?? 0,
        featured: unavailable ? false : existing?.featured ?? false,
        unavailable,
      };
    }),
  };
}

function getRemainingQuantity(item: MenuItemForm) {
  return Math.max(item.availableQuantity - item.soldQuantity, 0);
}

function getInventoryWarning(item: MenuItemForm, productName: string) {
  if (!item.included) return null;
  if (item.unavailable) return null;
  if (item.soldQuantity > item.availableQuantity) {
    return `${productName} has more sold than available.`;
  }
  if (item.availableQuantity === 0) {
    return `${productName} is included but has no sellable inventory.`;
  }
  return null;
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
  const includedItems = form.items.filter((item) => item.included);
  const summary = includedItems.reduce(
    (current, item) => ({
      available: current.available + (item.unavailable ? 0 : item.availableQuantity),
      sold: current.sold + (item.unavailable ? 0 : item.soldQuantity),
      remaining: current.remaining + (item.unavailable ? 0 : getRemainingQuantity(item)),
      featured: current.featured + (!item.unavailable && item.featured ? 1 : 0),
      unavailable: current.unavailable + (item.unavailable ? 1 : 0),
    }),
    { available: 0, sold: 0, remaining: 0, featured: 0, unavailable: 0 },
  );
  const includedItemCount = includedItems.length;

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
      try {
        const response = await fetch(`/api/admin/weekly-menu?id=${encodeURIComponent(id)}`);
        const payload = await readAdminJsonResponse(response);

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["selectedWeeklyMenu"]) ||
          !payload.selectedWeeklyMenu
        ) {
          setMessage(getAdminPayloadError(payload) || "Weekly menu could not be loaded.");
          return;
        }

        if (hasAdminKeys(payload, ["weeklyMenus"]) && Array.isArray(payload.weeklyMenus)) {
          setWeeklyMenus(payload.weeklyMenus as WeeklyMenuSummary[]);
          onWeeklyMenusChange(payload.weeklyMenus as WeeklyMenuSummary[]);
        }
        setForm(buildForm(payload.selectedWeeklyMenu as WeeklyMenu, products));
      } catch {
        setMessage("Weekly menu could not be loaded. Check your connection and try again.");
      }
    });
  }

  function saveWeeklyMenu() {
    setMessage(null);

    const validationMessage = validateWeeklyMenuForm({
      name: form.name,
      orderCutoffAt: form.orderCutoffAt,
      startsAt: form.startsAt,
      endsAt: form.endsAt,
      published: form.published,
      items: form.items.map((item) => ({
        ...item,
        productName:
          products.find((product) => product.id === item.productId)?.name || undefined,
      })),
    });
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    startTransition(async () => {
      try {
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
        const payload = await readAdminJsonResponse(response);

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["selectedWeeklyMenu"]) ||
          !payload.selectedWeeklyMenu
        ) {
          setMessage(getAdminPayloadError(payload) || "Weekly menu could not be saved.");
          return;
        }

        if (hasAdminKeys(payload, ["weeklyMenus"]) && Array.isArray(payload.weeklyMenus)) {
          setWeeklyMenus(payload.weeklyMenus as WeeklyMenuSummary[]);
          onWeeklyMenusChange(payload.weeklyMenus as WeeklyMenuSummary[]);
        }
        const selectedWeeklyMenu = payload.selectedWeeklyMenu as WeeklyMenu;
        onSelectedWeeklyMenuIdChange(selectedWeeklyMenu.id);
        setIsUnsavedClone(false);
        setForm(buildForm(selectedWeeklyMenu, products));
        setMessage("Weekly menu saved.");
        router.refresh();
      } catch {
        setMessage("Weekly menu could not be saved. Check your connection and try again.");
      }
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
          <Button
            type="button"
            variant="secondary"
            onClick={cloneAsNewMenu}
            disabled={isPending}
          >
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

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(230px,260px)_minmax(230px,260px)_max-content]">
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Menu name
          <input
            className="h-11 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Cutoff
          <input
            className="h-11 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
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
            className="h-11 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
            type="datetime-local"
            value={form.startsAt}
            onChange={(event) =>
              setForm((current) => ({ ...current, startsAt: event.target.value }))
            }
          />
        </label>
        <label className="flex items-end gap-2 pb-3 text-sm font-semibold text-stone-700 md:pt-6 xl:pt-0">
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

      <div className="mt-5 grid gap-3 rounded-md border border-stone-200 bg-[#fffaf2] p-4 sm:grid-cols-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Included
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">{includedItemCount}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Available
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">{summary.available}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Sold / left
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">
            {summary.sold} / {summary.remaining}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Featured
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">{summary.featured}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Unavailable
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">{summary.unavailable}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {products.map((product) => {
          const item = form.items.find((entry) => entry.productId === product.id);
          if (!item) return null;

          const warning = getInventoryWarning(item, product.name);
          const remainingQuantity = getRemainingQuantity(item);

          return (
            <div
              key={product.id}
              className={`rounded-md border p-4 ${
                item.included
                  ? warning
                    ? "border-amber-300 bg-amber-50"
                    : "border-stone-200 bg-white"
                  : "border-stone-200 bg-stone-50"
              }`}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_360px] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-stone-950">{product.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-stone-500">
                        {product.category} - {formatCurrency(product.priceCents)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700">
                        <input
                          type="checkbox"
                          aria-label={`Include ${product.name} in weekly menu`}
                          checked={item.included}
                          onChange={(event) =>
                            updateItem(product.id, {
                              included: event.target.checked,
                              featured: event.target.checked ? item.featured : false,
                              unavailable: event.target.checked ? item.unavailable : false,
                            })
                          }
                        />
                        Include
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700">
                        <input
                          type="checkbox"
                          aria-label={`Mark ${product.name} currently unavailable`}
                          checked={item.unavailable}
                          disabled={!item.included}
                          onChange={(event) =>
                            updateItem(product.id, {
                              unavailable: event.target.checked,
                              featured: event.target.checked ? false : item.featured,
                            })
                          }
                        />
                        Unavailable
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700">
                        <input
                          type="checkbox"
                          aria-label={`Feature ${product.name} on weekly menu`}
                          checked={item.featured}
                          disabled={!item.included || item.unavailable}
                          onChange={(event) =>
                            updateItem(product.id, { featured: event.target.checked })
                          }
                        />
                        Featured
                      </label>
                    </div>
                  </div>
                  {warning ? (
                    <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <AlertTriangle size={16} />
                      {warning}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Available
                    <input
                      className="h-10 min-w-0 rounded-md border border-stone-300 bg-white px-3 font-normal disabled:bg-stone-100"
                      aria-label={`${product.name} available quantity`}
                      disabled={!item.included || item.unavailable}
                      inputMode="numeric"
                      min={0}
                      step={1}
                      type="number"
                      value={item.availableQuantity}
                      onChange={(event) =>
                        updateItem(product.id, {
                          availableQuantity: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Sold
                    <input
                      className="h-10 min-w-0 rounded-md border border-stone-300 bg-white px-3 font-normal disabled:bg-stone-100"
                      aria-label={`${product.name} sold quantity`}
                      disabled={!item.included || item.unavailable}
                      inputMode="numeric"
                      min={0}
                      step={1}
                      type="number"
                      value={item.soldQuantity}
                      onChange={(event) =>
                        updateItem(product.id, {
                          soldQuantity: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="grid gap-1 text-sm font-semibold text-stone-700">
                    Left
                    <div className="flex h-10 items-center rounded-md border border-stone-200 bg-[#fffaf2] px-3 font-bold text-[#23443b]">
                      {item.included
                        ? item.unavailable
                          ? "Unavailable"
                          : remainingQuantity
                        : "-"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
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
