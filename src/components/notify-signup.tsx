"use client";

import { type FormEvent, useState, useTransition } from "react";
import { Bell, CheckCircle2, Loader2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { Button } from "./button";

export function NotifySignup({
  compact = false,
  source = "storefront",
}: {
  compact?: boolean;
  source?: string;
}) {
  const [email, setEmail] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submitSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    startTransition(async () => {
      try {
        trackEvent("notify_signup_start", {
          source,
          has_postal_code: Boolean(postalCode.trim()),
        });
        const response = await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            postalCode,
            preference: "Next weekly bake menu",
            source,
          }),
        });
        const payload = (await response.json()) as {
          error?: string;
          message?: string;
        };

        if (!response.ok) {
          setError(payload.error || "Signup could not be saved.");
          trackEvent("notify_signup_error", {
            source,
            status: response.status,
          });
          return;
        }

        setEmail("");
        setPostalCode("");
        setMessage(payload.message || "You are on the list.");
        trackEvent("notify_signup", {
          source,
          has_postal_code: Boolean(postalCode.trim()),
        });
      } catch {
        setError("Signup could not be saved. Please try again.");
        trackEvent("notify_signup_error", {
          source,
          status: "network_error",
        });
      }
    });
  }

  return (
    <form
      onSubmit={submitSignup}
      className={
        compact
          ? "grid gap-2"
          : "rounded-md border border-stone-200 bg-white p-5 shadow-sm"
      }
    >
      {!compact ? (
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#23443b] text-white">
            <Bell size={18} />
          </span>
          <div>
            <h2 className="text-xl font-bold text-stone-950">
              Get the next bake alert
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-700">
              Join the notification list for new weekly menus, restocks, and
              Canton-area delivery openings.
            </p>
          </div>
        </div>
      ) : null}

      <div
        className={
          compact
            ? "grid gap-2 sm:grid-cols-[1fr_96px_auto]"
            : "mt-5 grid gap-3 sm:grid-cols-[1fr_112px_auto]"
        }
      >
        <input
          className="h-11 min-w-0 rounded-md border border-stone-300 px-3 text-sm text-stone-950"
          name="notify-email"
          aria-label="Email for bake alerts"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="Email for bake alerts"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          className="h-11 rounded-md border border-stone-300 px-3 text-sm text-stone-950"
          name="notify-postal-code"
          aria-label="ZIP code for bake alerts"
          autoComplete="postal-code"
          inputMode="numeric"
          pattern="[0-9]{5}"
          placeholder="ZIP"
          value={postalCode}
          onChange={(event) =>
            setPostalCode(event.target.value.replace(/\D/g, "").slice(0, 5))
          }
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <Loader2 className="animate-spin" size={16} />
          ) : message ? (
            <CheckCircle2 size={16} />
          ) : (
            <Bell size={16} />
          )}
          Notify me
        </Button>
      </div>

      {message ? (
        <p className="mt-3 text-sm font-semibold text-[#23443b]" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm font-semibold text-[#a94334]" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
