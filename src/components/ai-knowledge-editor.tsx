"use client";

import { useMemo, useState, useTransition } from "react";
import { Bot, CheckCircle2, Loader2, Plus, Save } from "lucide-react";
import { validateAiKnowledgeForm } from "@/lib/admin-form-validation";
import type { AiKnowledgeEntry } from "@/lib/types";
import { Button } from "./button";

type AiKnowledgeForm = {
  id?: string;
  title: string;
  body: string;
  approved: boolean;
};

function entryToForm(entry?: AiKnowledgeEntry): AiKnowledgeForm {
  return {
    id: entry?.id,
    title: entry?.title || "",
    body: entry?.body || "",
    approved: entry?.approved ?? false,
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AiKnowledgeEditor({
  initialEntries,
}: {
  initialEntries: AiKnowledgeEntry[];
}) {
  const [entries, setEntries] = useState<AiKnowledgeEntry[]>(initialEntries);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEntries[0]?.id ?? null,
  );
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId),
    [entries, selectedId],
  );
  const [form, setForm] = useState<AiKnowledgeForm>(() =>
    entryToForm(selectedEntry),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const approvedCount = entries.filter((entry) => entry.approved).length;

  function selectEntry(entry: AiKnowledgeEntry) {
    setSelectedId(entry.id);
    setForm(entryToForm(entry));
    setMessage(null);
  }

  function newEntry() {
    setSelectedId(null);
    setForm(entryToForm());
    setMessage(null);
  }

  function saveEntry() {
    setMessage(null);
    const validationMessage = validateAiKnowledgeForm(form);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/admin/ai-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          title: form.title.trim(),
          body: form.body.trim(),
          approved: form.approved,
        }),
      });
      const payload = (await response.json()) as {
        entries?: AiKnowledgeEntry[];
        error?: string;
      };

      if (!response.ok || !payload.entries) {
        setMessage(payload.error || "AI knowledge entry could not be saved.");
        return;
      }

      setEntries(payload.entries);
      const savedEntry =
        payload.entries.find((entry) => entry.id === form.id) ??
        payload.entries.find(
          (entry) => entry.title.toLowerCase() === form.title.trim().toLowerCase(),
        ) ??
        payload.entries[0];
      setSelectedId(savedEntry?.id ?? null);
      setForm(entryToForm(savedEntry));
      setMessage("AI knowledge saved.");
    });
  }

  return (
    <section id="knowledge" className="mt-8 scroll-mt-28 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="text-[#a94334]" size={20} />
            <h2 className="text-xl font-bold text-stone-950">
              AI knowledge editor
            </h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Approved entries are the facts customer chat can use.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="rounded-md border border-stone-200 bg-[#fffaf2] px-3 py-2 text-sm font-semibold text-stone-700">
            {approvedCount} approved
          </div>
          <Button type="button" variant="secondary" onClick={newEntry} disabled={isPending}>
            <Plus size={16} />
            New fact
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="grid max-h-[560px] content-start gap-2 overflow-y-auto pr-1">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => selectEntry(entry)}
              disabled={isPending}
              className={`rounded-md border p-3 text-left transition ${
                selectedId === entry.id
                  ? "border-[#23443b] bg-[#f7efe3]"
                  : "border-stone-200 bg-white hover:bg-stone-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-stone-950">{entry.title}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    Updated {formatDate(entry.updatedAt)}
                  </p>
                </div>
                <span
                  className={`rounded-sm px-2 py-1 text-xs font-bold uppercase ${
                    entry.approved
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-stone-100 text-stone-600"
                  }`}
                >
                  {entry.approved ? "Approved" : "Draft"}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-stone-700">
                {entry.body}
              </p>
            </button>
          ))}

          {!entries.length ? (
            <div className="rounded-md border border-dashed border-stone-300 bg-[#fffaf2] p-5 text-sm text-stone-700">
              No AI knowledge entries yet.
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 rounded-md border border-stone-100 bg-[#fffaf2] p-4">
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Title
            <input
              className="h-11 rounded-md border border-stone-300 px-3 font-normal"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Delivery area"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Approved fact
            <textarea
              className="min-h-52 rounded-md border border-stone-300 p-3 font-normal leading-6"
              value={form.body}
              onChange={(event) =>
                setForm((current) => ({ ...current, body: event.target.value }))
              }
              placeholder="Luna & Lorelai's Sourdough delivers locally from Canton, GA..."
            />
          </label>

          <label className="flex items-start gap-2 text-sm font-semibold text-stone-700">
            <input
              className="mt-1"
              type="checkbox"
              checked={form.approved}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  approved: event.target.checked,
                }))
              }
            />
            Approved for customer chat
          </label>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
            Keep entries factual. Do not approve allergen-free guarantees,
            medical advice, legal advice, or delivery promises that are not true.
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="button" onClick={saveEntry} disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save fact
            </Button>
            {message ? (
              <span
                className={`inline-flex items-center gap-2 text-sm font-semibold ${
                  message === "AI knowledge saved."
                    ? "text-emerald-800"
                    : "text-[#a94334]"
                }`}
              >
                {message === "AI knowledge saved." ? <CheckCircle2 size={16} /> : null}
                {message}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
