"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Loader2,
  MailOpen,
  MapPin,
  Phone,
  Send,
} from "lucide-react";
import {
  getAdminPayloadError,
  hasAdminKeys,
  readAdminJsonResponse,
} from "@/lib/admin-api";
import {
  buildMailtoHref,
  buildMapSearchHref,
  buildTelHref,
} from "@/lib/admin-contact-links";
import {
  getCustomerMessageReplyWarning,
  hasAdminMessageDetails,
  parseAdminMessageDetails,
  summarizeCustomerMessages,
} from "@/lib/admin-message-details";
import { getAdminMessageStatusActions } from "@/lib/admin-message-workflow";
import type { CustomerMessage } from "@/lib/types";
import { Button, buttonClassName } from "./button";

const statusLabels: Record<string, string> = {
  new: "New",
  in_progress: "In progress",
  handled: "Handled",
  closed: "Closed",
};

const openStatuses = ["new", "in_progress"];
const filterOptions = ["open", "all", "new", "in_progress", "handled", "closed"];

function matchesMessageFilter(message: CustomerMessage, filter: string) {
  if (filter === "open") return openStatuses.includes(message.status);
  if (filter === "all") return true;
  return message.status === filter;
}

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
  const firstSelectedMessage =
    initialMessages.find((entry) => openStatuses.includes(entry.status)) ??
    initialMessages[0];
  const [messages, setMessages] = useState<CustomerMessage[]>(initialMessages);
  const [selectedId, setSelectedId] = useState<string | null>(
    firstSelectedMessage?.id ?? null,
  );
  const [filter, setFilter] = useState(
    initialMessages.some((entry) => openStatuses.includes(entry.status))
      ? "open"
      : "all",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [replySubject, setReplySubject] = useState(
    defaultReplySubject(firstSelectedMessage),
  );
  const [replyBody, setReplyBody] = useState("");
  const [statusAfterSend, setStatusAfterSend] = useState<"in_progress" | "handled">(
    "handled",
  );
  const [isPending, startTransition] = useTransition();

  const filteredMessages = useMemo(
    () => messages.filter((entry) => matchesMessageFilter(entry, filter)),
    [filter, messages],
  );
  const selectedMessage = useMemo(
    () =>
      filteredMessages.find((entry) => entry.id === selectedId) ??
      filteredMessages[0] ??
      null,
    [filteredMessages, selectedId],
  );

  const openCount = messages.filter(
    (entry) => entry.status === "new" || entry.status === "in_progress",
  ).length;
  const statusActions = selectedMessage
    ? getAdminMessageStatusActions(selectedMessage.status)
    : [];
  const inboxSummary = useMemo(() => summarizeCustomerMessages(messages), [messages]);
  const selectedDetails = selectedMessage
    ? parseAdminMessageDetails(selectedMessage.body)
    : null;
  const hasSelectedDetails = hasAdminMessageDetails(selectedDetails);
  const replyWarning = getCustomerMessageReplyWarning(selectedMessage);
  const selectedMessageEmailHref = selectedMessage
    ? buildMailtoHref(selectedMessage.customerEmail, defaultReplySubject(selectedMessage))
    : null;
  const selectedPhoneHref = selectedDetails ? buildTelHref(selectedDetails.phone) : null;
  const selectedMapHref = selectedDetails
    ? buildMapSearchHref(selectedDetails.address)
    : null;

  function updateStatus(id: string, status: string) {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/messages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status }),
        });
        const payload = await readAdminJsonResponse(response);

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["messages"]) ||
          !Array.isArray(payload.messages)
        ) {
          setMessage(getAdminPayloadError(payload) || "Message could not be updated.");
          return;
        }

        setMessages(payload.messages as CustomerMessage[]);
        setSelectedId(id);
        setFilter(openStatuses.includes(status) ? "open" : status);
        setMessage("Message updated.");
      } catch {
        setMessage("Message could not be updated. Check your connection and try again.");
      }
    });
  }

  function selectFilter(nextFilter: string) {
    const nextMessage = messages.find((entry) => matchesMessageFilter(entry, nextFilter));
    setFilter(nextFilter);
    setSelectedId(nextMessage?.id ?? null);
    setReplySubject(defaultReplySubject(nextMessage));
    setReplyBody("");
    setStatusAfterSend("handled");
    setMessage(null);
  }

  function sendReply() {
    if (!selectedMessage) return;
    setMessage(null);
    startTransition(async () => {
      try {
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
        const payload = await readAdminJsonResponse(response);

        if (
          !response.ok ||
          !hasAdminKeys(payload, ["messages"]) ||
          !Array.isArray(payload.messages)
        ) {
          setMessage(getAdminPayloadError(payload) || "Reply could not be sent.");
          return;
        }

        setMessages(payload.messages as CustomerMessage[]);
        setSelectedId(selectedMessage.id);
        setFilter(statusAfterSend);
        setReplyBody("");
        setMessage("Reply sent.");
      } catch {
        setMessage("Reply could not be sent. Check your connection and try again.");
      }
    });
  }

  return (
    <section id="requests" className="mt-8 scroll-mt-28 rounded-md border border-stone-200 bg-white p-5">
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

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {filterOptions.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => selectFilter(status)}
            disabled={isPending}
            className={`h-9 whitespace-nowrap rounded-md border px-3 text-sm font-semibold ${
              filter === status
                ? "border-[#23443b] bg-[#23443b] text-white"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
            }`}
          >
            {status === "open" ? "Open" : status === "all" ? "All" : statusLabels[status]}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3 rounded-md border border-stone-200 bg-[#fffaf2] p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            New
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">
            {inboxSummary.new}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Working
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">
            {inboxSummary.inProgress}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            Handled
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">
            {inboxSummary.handled}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
            No email
          </p>
          <p className="mt-1 text-2xl font-bold text-stone-950">
            {inboxSummary.noEmail}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="grid max-h-[520px] content-start gap-2 overflow-y-auto pr-1">
          {filteredMessages.map((entry) => (
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
              disabled={isPending}
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

          {!filteredMessages.length ? (
            <div className="rounded-md border border-dashed border-stone-300 bg-[#fffaf2] p-5 text-sm text-stone-700">
              No customer messages match this filter.
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
                  {selectedMessageEmailHref ? (
                    <a
                      className={buttonClassName({
                        variant: "secondary",
                        size: "sm",
                        className: "mt-3 w-fit",
                      })}
                      href={selectedMessageEmailHref}
                    >
                      <MailOpen size={15} />
                      Email customer
                    </a>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedPhoneHref ? (
                      <a
                        className={buttonClassName({
                          variant: "secondary",
                          size: "sm",
                        })}
                        href={selectedPhoneHref}
                      >
                        <Phone size={15} />
                        Call
                      </a>
                    ) : null}
                    {selectedMapHref ? (
                      <a
                        className={buttonClassName({
                          variant: "secondary",
                          size: "sm",
                        })}
                        href={selectedMapHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin size={15} />
                        Map
                      </a>
                    ) : null}
                  </div>
                </div>
                <MailOpen className="text-[#23443b]" size={22} />
              </div>

              {selectedDetails && hasSelectedDetails ? (
                <div className="mt-4 grid gap-3 rounded-md border border-stone-200 bg-white p-4 text-sm text-stone-700 sm:grid-cols-2">
                  {selectedDetails.customerName ? (
                    <div>
                      <p className="font-semibold text-stone-950">Customer</p>
                      <p className="mt-1">{selectedDetails.customerName}</p>
                    </div>
                  ) : null}
                  {selectedDetails.phone ? (
                    <div>
                      <p className="font-semibold text-stone-950">Phone</p>
                      <p className="mt-1">{selectedDetails.phone}</p>
                    </div>
                  ) : null}
                  {selectedDetails.requestedItems.length ? (
                    <div>
                      <p className="font-semibold text-stone-950">Requested items</p>
                      <ul className="mt-1 space-y-1">
                        {selectedDetails.requestedItems.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {selectedDetails.deliveryWindow ? (
                    <div>
                      <p className="font-semibold text-stone-950">Sunday delivery time</p>
                      <p className="mt-1">{selectedDetails.deliveryWindow}</p>
                    </div>
                  ) : null}
                  {selectedDetails.address ? (
                    <div className="sm:col-span-2">
                      <p className="font-semibold text-stone-950">Address</p>
                      <p className="mt-1">{selectedDetails.address}</p>
                    </div>
                  ) : null}
                  {selectedDetails.deliveryInstructions ? (
                    <div>
                      <p className="font-semibold text-stone-950">Delivery instructions</p>
                      <p className="mt-1">{selectedDetails.deliveryInstructions}</p>
                    </div>
                  ) : null}
                  {selectedDetails.notes ? (
                    <div>
                      <p className="font-semibold text-stone-950">Notes</p>
                      <p className="mt-1">{selectedDetails.notes}</p>
                    </div>
                  ) : null}
                  {selectedDetails.question ? (
                    <div className="sm:col-span-2">
                      <p className="font-semibold text-stone-950">Question</p>
                      <p className="mt-1">{selectedDetails.question}</p>
                    </div>
                  ) : null}
                  {selectedDetails.answerShown ? (
                    <div className="sm:col-span-2">
                      <p className="font-semibold text-stone-950">Answer shown</p>
                      <p className="mt-1">{selectedDetails.answerShown}</p>
                    </div>
                  ) : null}
                  {selectedDetails.zip || selectedDetails.interest ? (
                    <div className="sm:col-span-2">
                      <p className="font-semibold text-stone-950">Signup details</p>
                      <p className="mt-1">
                        {[selectedDetails.zip, selectedDetails.interest]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <pre className="mt-4 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-md border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-800">
                {selectedMessage.body}
              </pre>

              <div className="mt-4 grid gap-3 rounded-md border border-stone-200 bg-white p-4">
                {replyWarning ? (
                  <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                    <AlertTriangle className="mt-1 shrink-0" size={16} />
                    <p>{replyWarning}</p>
                  </div>
                ) : null}
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
                  disabled={
                    isPending ||
                    Boolean(replyWarning) ||
                    !replySubject.trim() ||
                    !replyBody.trim()
                  }
                  onClick={sendReply}
                >
                  {isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  Send reply
                </Button>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                {statusActions.map((action) => (
                  <Button
                    key={action.status}
                    type="button"
                    variant={
                      action.variant === "secondary"
                        ? "secondary"
                        : action.variant === "ghost"
                          ? "ghost"
                          : "primary"
                    }
                    disabled={isPending}
                    onClick={() => updateStatus(selectedMessage.id, action.status)}
                  >
                    {isPending ? <Loader2 className="animate-spin" size={16} /> : null}
                    {action.label}
                  </Button>
                ))}
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
              No message selected for this filter.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
