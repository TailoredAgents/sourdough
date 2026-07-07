import { z } from "zod";
import type { AiKnowledgeEntry } from "./types";
import { getSupabaseAdminClient } from "./supabase";

type AiKnowledgeRow = {
  id: string;
  title: string;
  body: string;
  approved: boolean;
  created_at: string;
  updated_at: string;
};

export const aiKnowledgeAdminSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(2).max(160),
  body: z.string().min(10).max(4000),
  approved: z.boolean(),
});

function mapAiKnowledgeEntry(row: AiKnowledgeRow): AiKnowledgeEntry {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    approved: row.approved,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAiKnowledgeEntriesData(): Promise<AiKnowledgeEntry[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("ai_knowledge_entries")
    .select("id, title, body, approved, created_at, updated_at")
    .order("approved", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[supabase] AI knowledge admin lookup failed", error.message);
    return [];
  }

  return (data as AiKnowledgeRow[]).map(mapAiKnowledgeEntry);
}

export async function upsertAiKnowledgeEntry(
  entry: z.infer<typeof aiKnowledgeAdminSchema>,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const now = new Date().toISOString();
  const row = {
    title: entry.title,
    body: entry.body,
    approved: entry.approved,
    updated_at: now,
  };

  const query = entry.id
    ? supabase.from("ai_knowledge_entries").update(row).eq("id", entry.id)
    : supabase.from("ai_knowledge_entries").insert({
        ...row,
        created_at: now,
      });

  const { error } = await query;
  if (error) throw new Error(error.message);

  return getAiKnowledgeEntriesData();
}
