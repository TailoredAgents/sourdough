export const adminDraftTypes = [
  "weekly_announcement",
  "product_description",
  "customer_reply",
  "order_summary",
] as const;

export type AdminDraftType = (typeof adminDraftTypes)[number];

export function isAdminDraftType(value: string): value is AdminDraftType {
  return adminDraftTypes.includes(value as AdminDraftType);
}

export function validateAdminDraftInput({
  context,
  type,
}: {
  context: string;
  type: string;
}) {
  if (!isAdminDraftType(type)) return "Choose a valid draft type.";
  if (!context.trim()) return "Add context before generating a draft.";
  if (context.length > 2000) return "Draft context must stay under 2000 characters.";
  return null;
}

export function extractAdminDraftText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const draft = (payload as { draft?: unknown }).draft;
  return typeof draft === "string" && draft.trim() ? draft : null;
}
