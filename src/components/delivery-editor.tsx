"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { validateDeliveryForm } from "@/lib/admin-form-validation";
import type { DeliverySettings } from "@/lib/delivery";
import type { DeliveryWindow, WeeklyMenuSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";

type DeliverySettingsForm = {
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  deliveryFeeDollars: string;
  allowedPostalCodes: string;
  serviceAreaCopy: string;
};

type DeliveryWindowForm = {
  clientId: string;
  id?: string;
  label: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reserved: number;
  remove: boolean;
};

type DeliveryPayload = {
  deliverySettings?: DeliverySettings;
  deliveryWindows?: DeliveryWindow[];
  weeklyMenuId?: string | null;
  error?: string;
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

function newClientId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random());
}

function buildSettingsForm(settings: DeliverySettings): DeliverySettingsForm {
  return {
    centerLat: settings.center.lat,
    centerLng: settings.center.lng,
    radiusMiles: settings.radiusMiles,
    deliveryFeeDollars: (settings.deliveryFeeCents / 100).toFixed(2),
    allowedPostalCodes: settings.allowedPostalCodes.join(", "),
    serviceAreaCopy: settings.serviceAreaCopy,
  };
}

function buildWindowForm(window: DeliveryWindow): DeliveryWindowForm {
  return {
    clientId: window.id,
    id: window.id,
    label: window.label,
    startsAt: toLocalInputValue(window.startsAt),
    endsAt: toLocalInputValue(window.endsAt),
    capacity: window.capacity,
    reserved: window.reserved,
    remove: false,
  };
}

function buildNewWindow(): DeliveryWindowForm {
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + 3);
  startsAt.setHours(10, 0, 0, 0);

  const endsAt = new Date(startsAt);
  endsAt.setHours(14, 0, 0, 0);

  return {
    clientId: newClientId(),
    label: "Saturday morning delivery",
    startsAt: toLocalInputValue(startsAt.toISOString()),
    endsAt: toLocalInputValue(endsAt.toISOString()),
    capacity: 10,
    reserved: 0,
    remove: false,
  };
}

export function DeliveryEditor({
  initialDeliverySettings,
  initialDeliveryWindows,
  onSelectedWeeklyMenuIdChange,
  selectedWeeklyMenuId,
  weeklyMenus,
}: {
  initialDeliverySettings: DeliverySettings;
  initialDeliveryWindows: DeliveryWindow[];
  onSelectedWeeklyMenuIdChange: (id: string) => void;
  selectedWeeklyMenuId: string;
  weeklyMenus: WeeklyMenuSummary[];
}) {
  const [settings, setSettings] = useState(() => buildSettingsForm(initialDeliverySettings));
  const [windows, setWindows] = useState(() => initialDeliveryWindows.map(buildWindowForm));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastLoadedMenuId = useRef(selectedWeeklyMenuId);

  const activeWindows = windows.filter((window) => !window.remove);
  const deliveryFeeCents = Math.round(Number(settings.deliveryFeeDollars || 0) * 100);

  function updateWindow(clientId: string, patch: Partial<DeliveryWindowForm>) {
    setWindows((current) =>
      current.map((window) =>
        window.clientId === clientId ? { ...window, ...patch } : window,
      ),
    );
  }

  function removeWindow(clientId: string) {
    setWindows((current) =>
      current.flatMap((window) => {
        if (window.clientId !== clientId) return [window];
        return window.id ? [{ ...window, remove: true }] : [];
      }),
    );
  }

  useEffect(() => {
    if (!selectedWeeklyMenuId || lastLoadedMenuId.current === selectedWeeklyMenuId) return;
    lastLoadedMenuId.current = selectedWeeklyMenuId;
    setMessage(null);

    startTransition(async () => {
      const response = await fetch(
        `/api/admin/delivery?weeklyMenuId=${encodeURIComponent(selectedWeeklyMenuId)}`,
      );
      const payload = (await response.json()) as DeliveryPayload;

      if (!response.ok || !payload.deliverySettings || !payload.deliveryWindows) {
        setMessage(payload.error || "Delivery windows could not be loaded.");
        return;
      }

      setSettings(buildSettingsForm(payload.deliverySettings));
      setWindows(payload.deliveryWindows.map(buildWindowForm));
    });
  }, [selectedWeeklyMenuId]);

  function selectWeeklyMenu(id: string) {
    if (!id) return;
    onSelectedWeeklyMenuIdChange(id);
  }

  function saveDelivery() {
    setMessage(null);

    const validationMessage = validateDeliveryForm({
      deliveryFeeDollars: settings.deliveryFeeDollars,
      allowedPostalCodes: settings.allowedPostalCodes,
      serviceAreaCopy: settings.serviceAreaCopy,
      windows,
    });
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/admin/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            centerLat: Number(settings.centerLat),
            centerLng: Number(settings.centerLng),
            radiusMiles: Number(settings.radiusMiles),
            deliveryFeeCents,
            allowedPostalCodes: settings.allowedPostalCodes
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            serviceAreaCopy: settings.serviceAreaCopy,
          },
          weeklyMenuId: selectedWeeklyMenuId || undefined,
          windows: windows.map((window) => ({
            id: window.id,
            label: window.label,
            startsAt: fromLocalInputValue(window.startsAt),
            endsAt: fromLocalInputValue(window.endsAt),
            capacity: Number(window.capacity),
            reserved: Number(window.reserved),
            remove: window.remove,
          })),
        }),
      });
      const payload = (await response.json()) as DeliveryPayload;

      if (!response.ok || !payload.deliverySettings || !payload.deliveryWindows) {
        setMessage(payload.error || "Delivery settings could not be saved.");
        return;
      }

      setSettings(buildSettingsForm(payload.deliverySettings));
      setWindows(payload.deliveryWindows.map(buildWindowForm));
      if (payload.weeklyMenuId) onSelectedWeeklyMenuIdChange(payload.weeklyMenuId);
      setMessage("Delivery settings saved.");
    });
  }

  return (
    <section id="delivery" className="mt-8 scroll-mt-28 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-xl font-bold text-stone-950">Delivery editor</h2>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Set allowed delivery ZIPs, delivery fee, and customer delivery slots.
          </p>
        </div>
        <Button type="button" onClick={saveDelivery} disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          Save delivery
        </Button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <label className="grid gap-1 text-sm font-semibold text-stone-700 lg:col-span-2">
          Delivery windows for bake drop
          <select
            className="h-11 rounded-md border border-stone-300 bg-white px-3 font-normal"
            value={selectedWeeklyMenuId}
            onChange={(event) => selectWeeklyMenu(event.target.value)}
            disabled={isPending || !weeklyMenus.length}
          >
            {!weeklyMenus.length ? <option value="">No menus yet</option> : null}
            {weeklyMenus.map((menu) => (
              <option key={menu.id} value={menu.id}>
                {menu.name} - {menu.published ? "published" : "draft"} - {menu.itemCount} items
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Allowed ZIP codes
          <input
            className="h-11 rounded-md border border-stone-300 px-3 font-normal"
            value={settings.allowedPostalCodes}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                allowedPostalCodes: event.target.value,
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Service area copy
          <input
            className="h-11 rounded-md border border-stone-300 px-3 font-normal"
            value={settings.serviceAreaCopy}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                serviceAreaCopy: event.target.value,
              }))
            }
          />
        </label>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Delivery fee
          <input
            className="h-11 rounded-md border border-stone-300 px-3 font-normal"
            min={0}
            step="0.01"
            type="number"
            value={settings.deliveryFeeDollars}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                deliveryFeeDollars: event.target.value,
              }))
            }
          />
        </label>
      </div>

      <div className="mt-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="font-bold text-stone-950">Delivery windows</h3>
          <p className="mt-1 text-sm text-stone-700">
            {activeWindows.length} active windows, {formatCurrency(deliveryFeeCents)} fee.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setWindows((current) => [...current, buildNewWindow()])}
          disabled={isPending}
        >
          <Plus size={16} />
          Add window
        </Button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="py-3">Label</th>
              <th className="py-3">Starts</th>
              <th className="py-3">Ends</th>
              <th className="py-3">Capacity</th>
              <th className="py-3">Reserved</th>
              <th className="py-3">Remove</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {activeWindows.map((window) => (
              <tr key={window.clientId}>
                <td className="py-3 pr-3">
                  <input
                    className="h-10 w-full min-w-52 rounded-md border border-stone-300 px-3"
                    value={window.label}
                    onChange={(event) =>
                      updateWindow(window.clientId, { label: event.target.value })
                    }
                  />
                </td>
                <td className="py-3 pr-3">
                  <input
                    className="h-10 rounded-md border border-stone-300 px-3"
                    type="datetime-local"
                    value={window.startsAt}
                    onChange={(event) =>
                      updateWindow(window.clientId, { startsAt: event.target.value })
                    }
                  />
                </td>
                <td className="py-3 pr-3">
                  <input
                    className="h-10 rounded-md border border-stone-300 px-3"
                    type="datetime-local"
                    value={window.endsAt}
                    onChange={(event) =>
                      updateWindow(window.clientId, { endsAt: event.target.value })
                    }
                  />
                </td>
                <td className="py-3 pr-3">
                  <input
                    className="h-10 w-24 rounded-md border border-stone-300 px-3"
                    min={0}
                    type="number"
                    value={window.capacity}
                    onChange={(event) =>
                      updateWindow(window.clientId, { capacity: Number(event.target.value) })
                    }
                  />
                </td>
                <td className="py-3 pr-3">
                  <input
                    className="h-10 w-24 rounded-md border border-stone-300 px-3"
                    min={0}
                    type="number"
                    value={window.reserved}
                    onChange={(event) =>
                      updateWindow(window.clientId, { reserved: Number(event.target.value) })
                    }
                  />
                </td>
                <td className="py-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeWindow(window.clientId)}
                    disabled={isPending}
                    aria-label={`Remove ${window.label}`}
                  >
                    <Trash2 size={16} />
                  </Button>
                </td>
              </tr>
            ))}
            {!activeWindows.length ? (
              <tr>
                <td className="py-6 text-sm text-stone-600" colSpan={6}>
                  No active delivery windows. Add one before opening checkout.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {message ? (
        <p
          className={`mt-4 inline-flex items-center gap-2 text-sm font-semibold ${
            message === "Delivery settings saved." ? "text-emerald-800" : "text-[#a94334]"
          }`}
        >
          {message === "Delivery settings saved." ? <CheckCircle2 size={16} /> : null}
          {message}
        </p>
      ) : null}
    </section>
  );
}
