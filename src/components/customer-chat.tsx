"use client";

import { useState, useTransition } from "react";
import { Bot, Loader2, Send } from "lucide-react";
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
        "Ask about this week's menu, allergens listed on product cards, delivery, or last-minute requests.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();

  function sendMessage() {
    const question = input.trim();
    if (!question) return;

    setInput("");
    setMessages((current) => [...current, { role: "user", content: question }]);
    startTransition(async () => {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      const payload = (await response.json()) as { answer: string };
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.answer,
        },
      ]);
    });
  }

  return (
    <section id="questions" className="bg-[#fffaf2] py-16 sm:py-20">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
            Bakery assistant
          </p>
          <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
            Questions answered from approved bakery info
          </h2>
          <p className="mt-4 text-base leading-7 text-stone-700">
            The chat is intentionally limited. It can help with menu, delivery,
            cutoff, and listed allergens, but it should escalate anything custom,
            urgent, legal, or medical.
          </p>
        </div>
        <div className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
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
          <div className="mt-4 flex gap-2">
            <input
              className="h-11 min-w-0 flex-1 rounded-md border border-stone-300 px-3 text-sm"
              placeholder="Ask about delivery or this week's loaves"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") sendMessage();
              }}
            />
            <Button type="button" onClick={sendMessage} disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              <span className="sr-only sm:not-sr-only">Send</span>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
