import { z } from "zod";

export function isSupportedProductImageUrl(
  value: string,
  supabaseProjectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
) {
  const trimmed = value.trim();
  if (
    trimmed.startsWith("/images/") &&
    !trimmed.includes("..") &&
    !trimmed.includes("\\")
  ) {
    return true;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return false;

    if (!supabaseProjectUrl) return false;

    const supabaseUrl = new URL(supabaseProjectUrl);
    return (
      url.hostname === supabaseUrl.hostname &&
      url.pathname.startsWith("/storage/v1/object/public/product-images/")
    );
  } catch {
    return false;
  }
}

const productImageUrlSchema = z
  .string()
  .trim()
  .refine(
    (value) => isSupportedProductImageUrl(value),
    "Use an uploaded product image or an app product image path.",
  )
  .nullable()
  .optional();

export const productAdminSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "Name is required.").max(120),
  category: z.enum(["bread", "add-on"]),
  description: z.string().min(10, "Description is required.").max(800),
  ingredients: z.array(z.string().min(1)).min(1, "Add at least one ingredient."),
  allergens: z.array(z.string().min(1)).default([]),
  priceCents: z.number().int().min(0).max(50000),
  imageUrl: productImageUrlSchema,
  imageStyle: z.string().min(3).max(160),
  active: z.boolean(),
  includeInCurrentMenu: z.boolean().optional().default(false),
  weeklyQuantity: z.number().int().min(0).max(1000).optional().default(0),
  featured: z.boolean().optional().default(false),
});

export type ProductAdminInput = z.infer<typeof productAdminSchema>;

export function slugifyProductName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinList(value: string[]) {
  return value.join(", ");
}
