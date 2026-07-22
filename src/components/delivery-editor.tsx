"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  DEFAULT_SUNDAY_DELIVERY_CAPACITY,
  formatSundayDeliveryWindowLabel,
  getFirstVisibleDeliveryWeekSchedule,
} from "@/lib/bake-schedule";
import {
  getAdminPayloadError,
  hasAdminKeys,
  readAdminJsonResponse,
} from "@/lib/admin-api";
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
  const schedule = getFirstVisibleDeliveryWeekSchedule();

  return {
    clientId: newClientId(),
    label: formatSundayDeliveryWindowLabel(
      schedule.deliveryStartsAt,
      schedule.deliveryEndsAt,
    ),
    startsAt: toLocalInputValue(schedule.deliveryStartsAt.toISOString()),
    endsAt: toLocalInputValue(schedule.deliveryEndsAt.toISOString()),
    capacity: DEFAULT_SUNDAY_DELIVERY_CAPACITY,
    reserved: 0,
    remove: false,
  };
}

function getOpenDeliverySpots(window: DeliveryWindowForm) {
  return Math.max(window.capacity - window.reserved, 0);
}

function getDeliveryWindowWarning(window: DeliveryWindowForm) {
  if (window.reserved > window.capacity) {
    return "Reserved spots are higher than capacity.";
  }
  if (window.capacity === 0) {
    return "Capacity is 0, so customers cannot choose this window.";
  }
  if (getOpenDeliverySpots(window) === 0) {
    return "This window is full.";
  }
  return null;
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
  const deliverySummary = activeWindows.reduce(
    (current, window) => ({
      capacity: current.capacity + window.capacity,
      reserved: current.reserved + window.reserved,
      open: current.open + getOpenDeliverySpots(window),
    }),
    { capacity: 0, reserved: 0, open: 0 },
  );

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
      try {
        const response = await fetch(
          `/api/admin/delivery?weeklyMenuId=${encodeURIComponent(selectedWeeklyMenuId)}`,
        );
        const payload = await readAdminJsonResponse(response);

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["deliverySettings", "deliveryWindows"]) ||
          !payload.deliverySettings ||
          !Array.isArray(payload.deliveryWindows)
        ) {
          setMessage(getAdminPayloadError(payload) || "Sunday delivery could not be loaded.");
          return;
        }

        setSettings(buildSettingsForm(payload.deliverySettings as DeliverySettings));
        setWindows((payload.deliveryWindows as DeliveryWindow[]).map(buildWindowForm));
      } catch {
        setMessage("Sunday delivery could not be loaded. Check your connection and try again.");
      }
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
      try {
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
        const payload = await readAdminJsonResponse(response);

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["deliverySettings", "deliveryWindows"]) ||
          !payload.deliverySettings ||
          !Array.isArray(payload.deliveryWindows)
        ) {
          setMessage(getAdminPayloadError(payload) || "Delivery settings could not be saved.");
          return;
        }

        setSettings(buildSettingsForm(payload.deliverySettings as DeliverySettings));
        setWindows((payload.deliveryWindows as DeliveryWindow[]).map(buildWindowForm));
        if (hasAdminKeys(payload, ["weeklyMenuId"]) && typeof payload.weeklyMenuId === "string") {
          onSelectedWeeklyMenuIdChange(payload.weeklyMenuId);
        }
        setMessage("Delivery settings saved.");
      } catch {
        setMessage("Delivery settings could not be saved. Check your connection and try again.");
      }
    });
  }

  return (
    <section id="delivery" className="mt-8 scroll-mt-28 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-xl font-bold text-stone-950">Sunday delivery editor</h2>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Set allowed ZIPs, delivery fee, and the Sunday 3:00-6:00 PM capacity.
          </p>
        </div>
        <Button type="button" onClick={saveDelivery} disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          Save delivery
        </Button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <label className="grid gap-1 text-sm font-semibold text-stone-700 lg:col-span-2">
          Sunday delivery week
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
          <h3 className="font-bold text-stone-950">Sunday delivery capacity</h3>
          <p className="mt-1 text-sm text-stone-700">
            {activeWindows.length} active Sunday slot, {formatCurrency(deliveryFeeCents)} fee.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setWindows((current) => [...current, buildNewWindow()])}
          disabled={isPending || activeWindows.length >= 1}
        >
          <Plus size={16} />
          Add Sunday slot
        </Button>
      </div>

      <div className="mt-4 grid gap-3 rounded-md border border-stone-200 bg-[#fffaf2] p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Sunday slots
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">
            {activeWindows.length}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Capacity
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">
            {deliverySummary.capacity}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Reserved
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">
            {deliverySummary.reserved}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Open spots
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">
            {deliverySummary.open}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {activeWindows.map((window) => {
          const warning = getDeliveryWindowWarning(window);
          const openSpots = getOpenDeliverySpots(window);
          const hasReservedOrders = window.reserved > 0;

          return (
            <div
              key={window.clientId}
              className={`rounded-md border p-4 ${
                warning ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-white"
              }`}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(360px,1.25fr)_auto] lg:items-start">
                <div className="grid gap-3">
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Customer label
                    <input
                      className="h-10 w-full min-w-52 rounded-md border border-stone-300 px-3"
                      aria-label={`Sunday delivery label for ${window.label}`}
                      value={window.label}
                      onChange={(event) =>
                        updateWindow(window.clientId, { label: event.target.value })
                      }
                    />
                  </label>
                  {warning ? (
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <AlertTriangle size={16} />
                      {warning}
                    </p>
                  ) : null}
                  {hasReservedOrders ? (
                    <p className="text-sm leading-6 text-stone-700">
                      Reserved Sunday slots cannot be removed until the related orders are
                      canceled or moved.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Starts
                    <input
                      className="h-10 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
                      aria-label={`${window.label} start time`}
                      type="datetime-local"
                      value={window.startsAt}
                      onChange={(event) =>
                        updateWindow(window.clientId, { startsAt: event.target.value })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Ends
                    <input
                      className="h-10 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
                      aria-label={`${window.label} end time`}
                      type="datetime-local"
                      value={window.endsAt}
                      onChange={(event) =>
                        updateWindow(window.clientId, { endsAt: event.target.value })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Capacity
                    <input
                      className="h-10 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
                      aria-label={`${window.label} capacity`}
                      inputMode="numeric"
                      min={0}
                      step={1}
                      type="number"
                      value={window.capacity}
                      onChange={(event) =>
                        updateWindow(window.clientId, { capacity: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Reserved
                    <input
                      className="h-10 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
                      aria-label={`${window.label} reserved spots`}
                      inputMode="numeric"
                      min={0}
                      step={1}
                      type="number"
                      value={window.reserved}
                      onChange={(event) =>
                        updateWindow(window.clientId, { reserved: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>

                <div className="flex flex-row items-center justify-between gap-3 lg:flex-col lg:items-end">
                  <div className="rounded-md border border-stone-200 bg-[#fffaf2] px-3 py-2 text-right">
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
                      Open
                    </p>
                    <p className="mt-1 text-xl font-bold text-[#23443b]">
                      {openSpots}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeWindow(window.clientId)}
                    disabled={isPending || hasReservedOrders}
                    aria-label={`Remove ${window.label}`}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        {!activeWindows.length ? (
          <div className="rounded-md border border-dashed border-stone-300 bg-[#fffaf2] p-5 text-sm text-stone-700">
            No active Sunday delivery slot. Add one before opening checkout.
          </div>
        ) : null}
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
