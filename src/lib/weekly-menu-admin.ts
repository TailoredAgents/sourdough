import { z } from "zod";

export const weeklyMenuAdminSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(120),
  orderCutoffAt: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  published: z.boolean(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      included: z.boolean(),
      availableQuantity: z.number().int().min(0).max(1000),
      soldQuantity: z.number().int().min(0).max(1000),
      featured: z.boolean(),
    }),
  ),
});

export type WeeklyMenuAdminInput = z.infer<typeof weeklyMenuAdminSchema>;
