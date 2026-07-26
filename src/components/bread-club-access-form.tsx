"use client";

import { Loader2, Mail } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "./button";

export function BreadClubAccessForm({
  accessStatus,
}: {
  accessStatus?: string;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(
    accessStatus === "expired"
      ? "That secure link expired or was already used. Request a new one below."
      : accessStatus === "invalid"
        ? "That secure link is invalid. Request a new one below."
        : accessStatus === "error"
          ? "The secure link could not be verified. Request a new one below."
          : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/bread-club/access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const payload = (await response.json()) as {
          message?: string;
          error?: string;
        };
        if (!response.ok) {
          setError(payload.error || "The secure link could not be sent.");
          return;
        }
        setMessage(
          payload.message ||
            "If that email has a membership, a secure link is on the way.",
        );
      } catch {
        setError("The secure link could not be sent. Please try again.");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto max-w-xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <span className="flex size-11 items-center justify-center rounded-md bg-[#23443b] text-white">
        <Mail size={20} />
      </span>
      <h1 className="mt-5 text-3xl font-bold text-stone-950">
        Manage Sunday Bread Club
      </h1>
      <p className="mt-3 text-sm leading-6 text-stone-700">
        Enter the email used at enrollment. We will send a single-use secure
        link that expires in 20 minutes.
      </p>
      <label className="mt-6 block text-sm font-bold text-stone-800">
        Membership email
        <input
          type="email"
          name="bread-club-access-email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 h-11 w-full border border-stone-300 px-3 font-normal"
        />
      </label>
      <Button type="submit" className="mt-4 w-full" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" size={17} /> : <Mail size={17} />}
        {isPending ? "Sending secure link..." : "Email my secure link"}
      </Button>
      {message ? (
        <p
          className="mt-4 border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950"
          role="status"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-4 border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
