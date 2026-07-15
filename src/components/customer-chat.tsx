"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Bot, Loader2, Send } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { Button } from "./button";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export function CustomerChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Ask about this week's loaves, listed allergens, local delivery, or order timing.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();

  function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (isPending) return;

    const question = input.trim();
    if (!question) return;

    setInput("");
    trackEvent("customer_question_submit", {
      question_length: question.length,
    });
    setMessages((current) => [...current, { role: "user", content: question }]);
    startTransition(async () => {
      let answer =
        "I could not answer that right now. Please include your question in the order notes and we will reply directly.";

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question }),
        });
        const payload = (await response.json()) as { answer?: string };
        answer = payload.answer || answer;
      } catch {
        // Keep the chat usable even if the assistant service is temporarily down.
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: answer,
        },
      ]);
    });
  }

  return (
    <section id="questions" className="scroll-mt-32 bg-[#fffaf2] py-16 sm:py-20">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
            Questions
          </p>
          <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
            Quick answers about ordering
          </h2>
          <p className="mt-4 text-base leading-7 text-stone-700">
            Ask about this week&apos;s menu, delivery area, order cutoff, and
            listed allergens before you checkout. For custom requests, include
            a note with your order.
          </p>
        </div>
        <div className="min-w-0 rounded-md border border-stone-200 bg-white p-4 shadow-sm">
          <div
            className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1"
            aria-live="polite"
          >
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={
                  message.role === "assistant"
                    ? "mr-8 rounded-md bg-[#f7efe3] p-3 text-sm leading-6 text-stone-700"
                    : "ml-8 rounded-md bg-[#23443b] p-3 text-sm leading-6 text-white"
                }
              >
                {message.role === "assistant" ? (
                  <Bot className="mb-2 text-[#a94334]" size={18} />
                ) : null}
                {message.content}
              </div>
            ))}
          </div>
          <form className="mt-4 flex gap-2" onSubmit={sendMessage}>
            <input
              className="h-11 min-w-0 flex-1 rounded-md border border-stone-300 px-3 text-sm"
              name="customer-question"
              aria-label="Customer question"
              autoComplete="off"
              placeholder="Ask about delivery or this week's loaves"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              <span className="sr-only sm:not-sr-only">Send</span>
            </Button>
          </form>
          <a
            href="#order"
            className="mt-3 inline-flex text-sm font-semibold text-[#23443b] underline"
          >
            Add a note to your order
          </a>
        </div>
      </div>
    </section>
  );
}
