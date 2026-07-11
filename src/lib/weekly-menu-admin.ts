import { z } from "zod";

function isValidDate(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}

const weeklyMenuItemAdminSchema = z
  .object({
    productId: z.string().uuid(),
    included: z.boolean(),
    availableQuantity: z.number().int().min(0).max(1000),
    soldQuantity: z.number().int().min(0).max(1000),
    featured: z.boolean(),
  })
  .refine((item) => item.soldQuantity <= item.availableQuantity, {
    message: "Sold quantity cannot be higher than available quantity.",
    path: ["soldQuantity"],
  });

export const weeklyMenuAdminSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(2).max(120),
    orderCutoffAt: z.string().min(1).refine(isValidDate, "Use a valid cutoff date."),
    startsAt: z.string().min(1).refine(isValidDate, "Use a valid start date."),
    endsAt: z.string().min(1).refine(isValidDate, "Use a valid end date."),
    published: z.boolean(),
    items: z.array(weeklyMenuItemAdminSchema),
  })
  .refine((menu) => new Date(menu.startsAt) < new Date(menu.endsAt), {
    message: "Menu start must be before menu end.",
    path: ["endsAt"],
  })
  .refine((menu) => new Date(menu.orderCutoffAt) <= new Date(menu.startsAt), {
    message: "Order cutoff must be before the menu starts.",
    path: ["orderCutoffAt"],
  });

export type WeeklyMenuAdminInput = z.infer<typeof weeklyMenuAdminSchema>;
