import { z } from "zod";

const deliveryWindowAdminSchema = z
  .object({
    id: z.string().uuid().optional(),
    label: z.string().min(2).max(120),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    capacity: z.number().int().min(0).max(1000),
    reserved: z.number().int().min(0).max(1000),
    remove: z.boolean().optional().default(false),
  })
  .refine((window) => window.reserved <= window.capacity, {
    message: "Reserved spots cannot be higher than capacity.",
    path: ["reserved"],
  });

export const deliveryAdminSchema = z.object({
  weeklyMenuId: z.string().uuid().optional(),
  settings: z.object({
    centerLat: z.number().min(-90).max(90),
    centerLng: z.number().min(-180).max(180),
    radiusMiles: z.number().min(0).max(100),
    deliveryFeeCents: z.number().int().min(0).max(50000),
    allowedPostalCodes: z
      .array(z.string().regex(/^\d{5}$/, "Use 5-digit ZIP codes."))
      .min(1, "Add at least one delivery ZIP code."),
    serviceAreaCopy: z.string().min(10).max(500),
  }),
  windows: z.array(deliveryWindowAdminSchema),
});

export type DeliveryAdminInput = z.infer<typeof deliveryAdminSchema>;
