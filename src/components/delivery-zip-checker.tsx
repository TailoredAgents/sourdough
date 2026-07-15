"use client";

import { useState, useTransition, type FormEvent } from "react";
import { CheckCircle2, Loader2, MapPin, AlertCircle } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";

type DeliveryCheck = {
  eligible: boolean;
  message: string;
  feeCents: number;
  postalCode: string | null;
};

export function DeliveryZipChecker({
  source,
  city = "Canton",
}: {
  source: string;
  city?: string;
}) {
  const [postalCode, setPostalCode] = useState("");
  const [result, setResult] = useState<DeliveryCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updatePostalCode(value: string) {
    setPostalCode(value.replace(/\D/g, "").slice(0, 5));
  }

  function checkZip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/delivery/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            line1: "",
            city,
            state: "GA",
            postalCode,
          }),
        });
        const payload = (await response.json()) as DeliveryCheck;

        if (!response.ok) {
          setError(payload.message || "Delivery could not be checked.");
          return;
        }

        setResult(payload);
        trackEvent("check_delivery", {
          source,
          eligible: payload.eligible,
          postal_code: payload.postalCode || postalCode,
          fee_cents: payload.feeCents,
        });
      } catch {
        setError("Delivery could not be checked. Please try again.");
      }
    });
  }

  return (
    <form
      onSubmit={checkZip}
      className="rounded-md border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#23443b] text-white">
          <MapPin size={18} />
        </span>
        <div>
          <h3 className="font-bold text-stone-950">Check your delivery ZIP</h3>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Confirm local delivery before you start building an order.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm text-stone-950"
          name="quick-postal-code"
          aria-label="Delivery ZIP code"
          autoComplete="postal-code"
          inputMode="numeric"
          pattern="[0-9]{5}"
          placeholder="30114"
          value={postalCode}
          onInput={(event) => updatePostalCode(event.currentTarget.value)}
          onChange={(event) => updatePostalCode(event.target.value)}
          required
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
          Check ZIP
        </Button>
      </div>

      {result ? (
        <div
          className="mt-4 flex gap-2 rounded-md bg-[#fffaf2] p-3 text-sm leading-6 text-stone-700"
          role="status"
          aria-live="polite"
        >
          {result.eligible ? (
            <CheckCircle2 className="mt-1 shrink-0 text-[#23443b]" size={18} />
          ) : (
            <AlertCircle className="mt-1 shrink-0 text-[#a94334]" size={18} />
          )}
          <p>
            {result.message}
            {result.eligible ? ` Delivery fee: ${formatCurrency(result.feeCents)}.` : ""}
          </p>
        </div>
      ) : null}

      {result?.eligible && result.postalCode ? (
        <a
          href={`/?zip=${encodeURIComponent(result.postalCode)}#order`}
          data-analytics-event="order_cta_click"
          data-analytics-label="Order with checked ZIP"
          data-analytics-section={source}
          className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-[#23443b] px-4 text-sm font-bold text-white transition hover:bg-[#1b352e]"
        >
          Order with this ZIP
        </a>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm font-semibold text-[#a94334]" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
