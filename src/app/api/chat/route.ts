import { NextResponse } from "next/server";
import { z } from "zod";
import { buildChatFallbackAnswer } from "@/lib/chat-fallback";
import { getCutoffMessage } from "@/lib/cutoff";
import { aiModel, getOpenAI } from "@/lib/openai";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getActiveMenuData,
  getActiveWeeklyMenuData,
  getApprovedAiKnowledgeData,
  getDeliverySettingsData,
} from "@/lib/storefront-data";

const chatSchema = z.object({
  message: z.string().min(1).max(1000),
});

export function fallbackAnswer(message: string) {
  return buildChatFallbackAnswer(message);
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
  let fallback = fallbackAnswer(parsed.data.message);

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

    const [menu, weeklyMenu, deliverySettings, aiKnowledge] = await Promise.all([
      getActiveMenuData(),
      getActiveWeeklyMenuData(),
      getDeliverySettingsData(),
      getApprovedAiKnowledgeData(),
    ]);
    fallback = buildChatFallbackAnswer(parsed.data.message, {
      menu,
      weeklyMenu,
      deliverySettings,
    });
    const openai = getOpenAI();
    if (!openai) {
      return NextResponse.json({ answer: fallback });
    }

    const menuContext = menu
      .map(
        (item) =>
          `${item.name}: ${item.description} Price ${item.priceCents / 100}. Ingredients: ${item.ingredients.join(", ")}. Allergens: ${item.allergens.join(", ")}. Remaining: ${item.remainingQuantity}.`,
      )
      .join("\n");
    const deliveryContext = `Allowed delivery ZIP codes: ${deliverySettings.allowedPostalCodes.join(", ")}. Delivery fee: ${deliverySettings.deliveryFeeCents / 100}. Service area copy: ${deliverySettings.serviceAreaCopy}`;
    const cutoffContext = getCutoffMessage(weeklyMenu?.orderCutoffAt);

    const response = await openai.responses.create({
      model: aiModel,
      instructions:
        "You are the Luna & Lorelai's Sourdough customer assistant. Answer only from the provided bakery facts and menu. Do not invent ingredients, inventory, legal claims, medical advice, or allergen-free guarantees. If the answer is not supported, say the bakery should confirm directly. Keep answers short and friendly.",
      input: `Approved bakery facts:\n${aiKnowledge.join("\n")}\n\nCurrent cutoff:\n${cutoffContext}\n\nDelivery:\n${deliveryContext}\n\nCurrent menu:\n${menuContext}\n\nCustomer question:\n${parsed.data.message}`,
    });

    return NextResponse.json({
      answer: response.output_text || fallback,
    });
  } catch (error) {
    console.error("[chat] failed to answer question", error);
    return NextResponse.json({ answer: fallback });
  }
}
