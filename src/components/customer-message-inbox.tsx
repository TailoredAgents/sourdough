"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Inbox, Loader2, MailOpen, Send } from "lucide-react";
import type { CustomerMessage } from "@/lib/types";
import { Button } from "./button";

const statusLabels: Record<string, string> = {
  new: "New",
  in_progress: "In progress",
  handled: "Handled",
  closed: "Closed",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function defaultReplySubject(message?: CustomerMessage) {
  return message ? `Re: ${message.subject}` : "";
}

export function CustomerMessageInbox({
  initialMessages,
}: {
  initialMessages: CustomerMessage[];
}) {
  const [messages, setMessages] = useState<CustomerMessage[]>(initialMessages);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialMessages[0]?.id ?? null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [replySubject, setReplySubject] = useState(
    defaultReplySubject(initialMessages[0]),
  );
  const [replyBody, setReplyBody] = useState("");
  const [statusAfterSend, setStatusAfterSend] = useState<"in_progress" | "handled">(
    "handled",
  );
  const [isPending, startTransition] = useTransition();

  const selectedMessage = useMemo(
    () => messages.find((entry) => entry.id === selectedId) ?? messages[0],
    [messages, selectedId],
  );

  const openCount = messages.filter(
    (entry) => entry.status === "new" || entry.status === "in_progress",
  ).length;

  function updateStatus(id: string, status: string) {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/admin/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload = (await response.json()) as {
        messages?: CustomerMessage[];
        error?: string;
      };

      if (!response.ok || !payload.messages) {
        setMessage(payload.error || "Message could not be updated.");
        return;
      }

      setMessages(payload.messages);
      setSelectedId(id);
      setMessage("Message updated.");
    });
  }

  function sendReply() {
    if (!selectedMessage) return;
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedMessage.id,
          subject: replySubject.trim(),
          body: replyBody.trim(),
          statusAfterSend,
        }),
      });
      const payload = (await response.json()) as {
        messages?: CustomerMessage[];
        error?: string;
      };

      if (!response.ok || !payload.messages) {
        setMessage(payload.error || "Reply could not be sent.");
        return;
      }

      setMessages(payload.messages);
      setSelectedId(selectedMessage.id);
      setReplyBody("");
      setMessage("Reply sent.");
    });
  }

  return (
    <section className="mt-8 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <Inbox className="text-[#a94334]" size={20} />
            <h2 className="text-xl font-bold text-stone-950">
              Customer request inbox
            </h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Review last-minute requests and customer messages before responding.
          </p>
        </div>
        <div className="rounded-md border border-stone-200 bg-[#fffaf2] px-3 py-2 text-sm font-semibold text-stone-700">
          {openCount} open requests
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="grid max-h-[520px] content-start gap-2 overflow-y-auto pr-1">
          {messages.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setSelectedId(entry.id);
                setReplySubject(defaultReplySubject(entry));
                setReplyBody("");
                setStatusAfterSend("handled");
                setMessage(null);
              }}
              className={`rounded-md border p-3 text-left transition ${
                selectedMessage?.id === entry.id
                  ? "border-[#23443b] bg-[#f7efe3]"
                  : "border-stone-200 bg-white hover:bg-stone-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-stone-950">{entry.subject}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {entry.customerEmail || "No email"} - {formatDate(entry.createdAt)}
                  </p>
                </div>
                <span
                  className={`rounded-sm px-2 py-1 text-xs font-bold uppercase ${
                    entry.status === "new"
                      ? "bg-amber-50 text-amber-900"
                      : entry.status === "handled"
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-stone-100 text-stone-600"
                  }`}
                >
                  {statusLabels[entry.status] || entry.status}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-stone-700">
                {entry.body}
              </p>
            </button>
          ))}

          {!messages.length ? (
            <div className="rounded-md border border-dashed border-stone-300 bg-[#fffaf2] p-5 text-sm text-stone-700">
              No customer messages yet.
            </div>
          ) : null}
        </div>

        <div className="rounded-md border border-stone-100 bg-[#fffaf2] p-4">
          {selectedMessage ? (
            <>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-[#a94334]">
                    {statusLabels[selectedMessage.status] || selectedMessage.status}
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-stone-950">
                    {selectedMessage.subject}
                  </h3>
                  <p className="mt-1 text-sm text-stone-600">
                    {selectedMessage.customerEmail || "No email"} -{" "}
                    {formatDate(selectedMessage.createdAt)}
                  </p>
                </div>
                <MailOpen className="text-[#23443b]" size={22} />
              </div>

              <pre className="mt-4 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-md border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-800">
                {selectedMessage.body}
              </pre>

              <div className="mt-4 grid gap-3 rounded-md border border-stone-200 bg-white p-4">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Reply subject
                  <input
                    className="h-10 rounded-md border border-stone-300 px-3 font-normal"
                    value={replySubject}
                    onChange={(event) => setReplySubject(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Reply body
                  <textarea
                    className="min-h-32 rounded-md border border-stone-300 p-3 font-normal leading-6"
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    placeholder="Write the customer reply here."
                  />
                </label>
                <label className="grid max-w-xs gap-1 text-sm font-semibold text-stone-700">
                  After sending
                  <select
                    className="h-10 rounded-md border border-stone-300 bg-white px-3 font-normal"
                    value={statusAfterSend}
                    onChange={(event) =>
                      setStatusAfterSend(event.target.value as "in_progress" | "handled")
                    }
                  >
                    <option value="handled">Mark handled</option>
                    <option value="in_progress">Keep in progress</option>
                  </select>
                </label>
                <Button
                  type="button"
                  disabled={isPending || !replySubject.trim() || !replyBody.trim()}
                  onClick={sendReply}
                >
                  {isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  Send reply
                </Button>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => updateStatus(selectedMessage.id, "in_progress")}
                >
                  {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
                  Working on it
                </Button>
                <Button
                  type="button"
                  disabled={isPending}
                  onClick={() => updateStatus(selectedMessage.id, "handled")}
                >
                  {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
                  Mark handled
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => updateStatus(selectedMessage.id, "closed")}
                >
                  Close
                </Button>
                {message ? (
                  <span
                    className={`inline-flex items-center gap-2 text-sm font-semibold ${
                      message === "Message updated." || message === "Reply sent."
                        ? "text-emerald-800"
                        : "text-[#a94334]"
                    }`}
                  >
                    {message === "Message updated." || message === "Reply sent." ? (
                      <CheckCircle2 size={16} />
                    ) : null}
                    {message}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-stone-300 bg-white p-5 text-sm text-stone-700">
              Select a message to review.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
