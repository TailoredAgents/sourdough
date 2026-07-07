import { z } from "zod";

export const productAdminSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "Name is required.").max(120),
  category: z.enum(["bread", "add-on"]),
  description: z.string().min(10, "Description is required.").max(800),
  ingredients: z.array(z.string().min(1)).min(1, "Add at least one ingredient."),
  allergens: z.array(z.string().min(1)).default([]),
  priceCents: z.number().int().min(0).max(50000),
  imageUrl: z.string().url().nullable().optional(),
  imageStyle: z.string().min(3).max(160),
  active: z.boolean(),
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
