"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "./button";

export function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { message?: string; error?: string };
      setMessage(payload.message || payload.error || "Check your email.");
    });
  }

  return (
    <form onSubmit={submitLogin} className="mt-6 grid gap-3">
      <label className="grid gap-2 text-left text-sm font-semibold text-stone-700">
        Email
        <input
          className="h-11 rounded-md border border-stone-300 px-3 text-sm font-normal"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="owner@example.com"
        />
      </label>
      <Button type="submit" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />}
        Send magic link
      </Button>
      {message ? (
        <p className="rounded-md bg-[#fffaf2] p-3 text-sm leading-6 text-stone-700">
          {message}
        </p>
      ) : null}
    </form>
  );
}
