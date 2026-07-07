"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "./button";

export function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const payload = (await response.json()) as {
          message?: string;
          error?: string;
        };
        setMessage(payload.message || payload.error || "Unable to log in.");

        if (response.ok) {
          window.location.assign("/admin");
        }
      } catch {
        setMessage("Unable to log in. Please try again.");
      }
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
      <label className="grid gap-2 text-left text-sm font-semibold text-stone-700">
        Password
        <input
          className="h-11 rounded-md border border-stone-300 px-3 text-sm font-normal"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
        />
      </label>
      <Button type="submit" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" size={16} /> : <LogIn size={16} />}
        Log in
      </Button>
      {message ? (
        <p className="rounded-md bg-[#fffaf2] p-3 text-sm leading-6 text-stone-700">
          {message}
        </p>
      ) : null}
    </form>
  );
}
