import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import {
  aiKnowledgeAdminSchema,
  getAiKnowledgeEntriesData,
  upsertAiKnowledgeEntry,
} from "@/lib/ai-knowledge-admin";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  return NextResponse.json({ entries: await getAiKnowledgeEntriesData() });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const parsed = aiKnowledgeAdminSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid AI knowledge entry." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      entries: await upsertAiKnowledgeEntry(parsed.data),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI knowledge entry could not be saved.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
