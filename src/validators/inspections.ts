// src/validators/inspections.ts
import { z } from "zod";

export const FuelLevel = z.string().regex(/^([0-8])\/8$/, "fuel must be like '7/8','4/8' etc");

export const InspectionInput = z.object({
  odoKm: z.coerce.number().int().nonnegative(),
  fuelLevel: FuelLevel,
  photos: z.array(z.string()).max(12).default([]),
  checklist: z.record(z.boolean()).default({}),
  notes: z.string().max(1000).optional()
});

export type InspectionInputType = z.infer<typeof InspectionInput>;
