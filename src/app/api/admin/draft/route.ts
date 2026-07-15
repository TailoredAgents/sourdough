import { NextResponse } from "next/server";
import { z } from "zod";
import { adminDraftTypes } from "@/lib/admin-draft";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { aiModel, getOpenAI } from "@/lib/openai";
import {
  getActiveMenuData,
  getApprovedAiKnowledgeData,
} from "@/lib/storefront-data";

const draftSchema = z.object({
  type: z.enum(adminDraftTypes),
  context: z.string().min(1).max(2000),
});

export function fallbackDraft(type: string, context: string) {
  if (type === "weekly_announcement") {
    return `This week's Luna & Lorelai's Sourdough bake is open for local delivery orders from Canton, GA.\n\n${context}\n\nQuantities are limited. Review the current weekly menu cutoff before publishing this draft.`;
  }

  return `Draft for review:\n\n${context}\n\nPlease confirm product details, delivery timing, and any allergen wording before sending.`;
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const parsed = draftSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ draft: "Please provide a draft type and context." });
  }

  const openai = getOpenAI();
  if (!openai) {
    return NextResponse.json({
      draft: fallbackDraft(parsed.data.type, parsed.data.context),
    });
  }

  try {
    const [menu, aiKnowledge] = await Promise.all([
      getActiveMenuData(),
      getApprovedAiKnowledgeData(),
    ]);

    const menuContext = menu
      .map((item) => `${item.name}: ${item.description}`)
      .join("\n");

    const response = await openai.responses.create({
      model: aiModel,
      instructions:
        "You draft concise bakery copy for the owner of Luna & Lorelai's Sourdough. Draft only; never claim the message has been sent. Preserve legal and allergen caution. Mention that customer-facing text should be reviewed before publishing.",
      input: `Draft type: ${parsed.data.type}\n\nOwner context:\n${parsed.data.context}\n\nApproved facts:\n${aiKnowledge.join("\n")}\n\nMenu:\n${menuContext}`,
    });

    return NextResponse.json({
      draft: response.output_text || fallbackDraft(parsed.data.type, parsed.data.context),
    });
  } catch (error) {
    console.error("[admin:draft] failed to generate draft", error);
    return NextResponse.json({
      draft: fallbackDraft(parsed.data.type, parsed.data.context),
    });
  }
}
