// src/validators/bookings.ts
import { z } from "zod";

export const BookingQuote = z.object({
  vehicleId: z.string().min(10),
  ratePlanId: z.string().min(10),
  startTs: z.coerce.date(),
  endTs: z.coerce.date().refine((d, ctx) => {
    const { startTs } = ctx.parent as any;
    return startTs && d > startTs;
  }, "endTs must be after startTs"),
});

export const BookingCreate = BookingQuote.extend({
  customer: z.object({
    fullName: z.string().min(2),
    phoneE164: z.string().regex(/^\+\d{7,15}$/),
    email: z.string().email().optional()
  }),
  notes: z.string().max(1000).optional()
});

export type BookingQuoteInput = z.infer<typeof BookingQuote>;
export type BookingCreateInput = z.infer<typeof BookingCreate>;
