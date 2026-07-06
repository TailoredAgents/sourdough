import { NextResponse } from "next/server";
import { z } from "zod";
import { aiKnowledge, getActiveMenu } from "@/lib/bakery-data";
import { aiModel, getOpenAI } from "@/lib/openai";

const chatSchema = z.object({
  message: z.string().min(1).max(1000),
});

function fallbackAnswer(message: string) {
  const lower = message.toLowerCase();

  if (lower.includes("allergen") || lower.includes("ingredient")) {
    return "Please check each product card for listed ingredients and allergens. L&L should not claim allergen-free preparation; contact the bakery for ingredient questions before ordering.";
  }

  if (lower.includes("deliver") || lower.includes("shipping") || lower.includes("ship")) {
    return "L&L Sourdough is planned for local Georgia delivery from Canton, GA only. The launch site does not support shipping or out-of-state orders.";
  }

  if (lower.includes("cutoff") || lower.includes("deadline") || lower.includes("late")) {
    return "Weekly orders close Thursday at 8:00 PM for the next week's bake. After that, send a last-minute request and L&L will confirm what is possible.";
  }

  return "I can help with the weekly menu, listed allergens, local delivery, and Thursday cutoff. For custom or urgent questions, send a note with your order request so L&L can reply directly.";
}

export async function POST(request: Request) {
  const parsed = chatSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ answer: "Please ask a short bakery question." });
  }

  const openai = getOpenAI();
  if (!openai) {
    return NextResponse.json({ answer: fallbackAnswer(parsed.data.message) });
  }

  const menuContext = getActiveMenu()
    .map(
      (item) =>
        `${item.name}: ${item.description} Price ${item.priceCents / 100}. Ingredients: ${item.ingredients.join(", ")}. Allergens: ${item.allergens.join(", ")}. Remaining: ${item.remainingQuantity}.`,
    )
    .join("\n");

  const response = await openai.responses.create({
    model: aiModel,
    instructions:
      "You are the L&L Sourdough customer assistant. Answer only from the provided bakery facts and menu. Do not invent ingredients, inventory, legal claims, medical advice, or allergen-free guarantees. If the answer is not supported, say the bakery should confirm directly. Keep answers short and friendly.",
    input: `Approved bakery facts:\n${aiKnowledge.join("\n")}\n\nCurrent menu:\n${menuContext}\n\nCustomer question:\n${parsed.data.message}`,
  });

  return NextResponse.json({ answer: response.output_text || fallbackAnswer(parsed.data.message) });
}
