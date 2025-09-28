// src/validators/ratePlans.ts
import { z } from "zod";

export const RatePlanCreate = z.object({
  name: z.string().min(2).max(60),
  dailyRate: z.coerce.number().int().positive(),
  weeklyRate: z.coerce.number().int().positive().optional(),
  depositAmount: z.coerce.number().int().nonnegative(),
  kmIncludedPerDay: z.coerce.number().int().positive().default(150),
  extraKmRate: z.coerce.number().int().nonnegative().default(0),
  weekendMultiplier: z.coerce.number().min(0.5).max(5).default(1.0),
  active: z.coerce.boolean().default(true),
});

export type RatePlanCreateInput = z.infer<typeof RatePlanCreate>;
