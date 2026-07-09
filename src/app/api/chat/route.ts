import { NextResponse } from "next/server";
import { z } from "zod";
import { aiModel, getOpenAI } from "@/lib/openai";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getActiveMenuData,
  getApprovedAiKnowledgeData,
} from "@/lib/storefront-data";

const chatSchema = z.object({
  message: z.string().min(1).max(1000),
});

export function fallbackAnswer(message: string) {
  const lower = message.toLowerCase();

  if (
    lower.includes("medical") ||
    lower.includes("doctor") ||
    lower.includes("safe for") ||
    lower.includes("celiac") ||
    lower.includes("diabetes")
  ) {
    return "I cannot give medical or dietary safety advice. Please review the listed ingredients and allergens, and contact the bakery directly before ordering.";
  }

  if (lower.includes("legal") || lower.includes("law") || lower.includes("license")) {
    return "I cannot give legal advice. Please consult the appropriate agency or professional for cottage-food, tax, or local business requirements.";
  }

  if (
    lower.includes("allergen-free") ||
    lower.includes("gluten-free") ||
    lower.includes("nut-free") ||
    lower.includes("allergy")
  ) {
    return "The bakery does not claim allergen-free preparation. Please use the listed allergens on each product card and contact the bakery before ordering with allergy questions.";
  }

  if (lower.includes("allergen") || lower.includes("ingredient")) {
    return "Please check each product card for listed ingredients and allergens. The bakery does not claim allergen-free preparation; contact the bakery for ingredient questions before ordering.";
  }

  if (lower.includes("deliver") || lower.includes("shipping") || lower.includes("ship")) {
    return "Luna & Lorelai's Sourdough offers local Georgia delivery from Canton, GA only. Shipping and out-of-state orders are not available.";
  }

  if (lower.includes("cutoff") || lower.includes("deadline") || lower.includes("late")) {
    return "Weekly orders close Thursday at 8:00 PM for the next week's bake. After that, send a last-minute request and the bakery will confirm what is possible.";
  }

  if (lower.includes("custom") || lower.includes("special order")) {
    return "Custom requests need direct bakery confirmation. Add the request in the order notes or contact the bakery before assuming it is available.";
  }

  return "I can help with the weekly menu, listed allergens, local delivery, and Thursday cutoff. For custom or urgent questions, send a note with your order request so the bakery can reply directly.";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ answer: "Please ask a short bakery question." });
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ answer: "Please ask a short bakery question." });
  }

  try {
    const forwardedFor = request.headers.get("x-forwarded-for") || "";
    const clientKey =
      forwardedFor.split(",")[0]?.trim() ||
      request.headers.get("user-agent") ||
      "unknown-client";
    const rateLimit = await checkRateLimit({
      scope: "customer_chat",
      key: clientKey,
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          answer:
            "Too many questions were sent in a short time. Please try again later or contact the bakery directly.",
        },
        { status: 429 },
      );
    }

    const openai = getOpenAI();
    if (!openai) {
      return NextResponse.json({ answer: fallbackAnswer(parsed.data.message) });
    }

    const [menu, aiKnowledge] = await Promise.all([
      getActiveMenuData(),
      getApprovedAiKnowledgeData(),
    ]);

    const menuContext = menu
      .map(
        (item) =>
          `${item.name}: ${item.description} Price ${item.priceCents / 100}. Ingredients: ${item.ingredients.join(", ")}. Allergens: ${item.allergens.join(", ")}. Remaining: ${item.remainingQuantity}.`,
      )
      .join("\n");

    const response = await openai.responses.create({
      model: aiModel,
      instructions:
        "You are the Luna & Lorelai's Sourdough customer assistant. Answer only from the provided bakery facts and menu. Do not invent ingredients, inventory, legal claims, medical advice, or allergen-free guarantees. If the answer is not supported, say the bakery should confirm directly. Keep answers short and friendly.",
      input: `Approved bakery facts:\n${aiKnowledge.join("\n")}\n\nCurrent menu:\n${menuContext}\n\nCustomer question:\n${parsed.data.message}`,
    });

    return NextResponse.json({
      answer: response.output_text || fallbackAnswer(parsed.data.message),
    });
  } catch (error) {
    console.error("[chat] failed to answer question", error);
    return NextResponse.json({ answer: fallbackAnswer(parsed.data.message) });
  }
}
