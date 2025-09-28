// src/routes/bookings.ts
import { Router } from "express";
import { db } from "../db/drizzle";
import { bookings, customers, vehicles, ratePlans } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { BookingQuote, BookingCreate } from "../validators/bookings";
import { newId, shortCode } from "../utils/id";

export const bookingsRouter = Router();

// naive availability check (no overlap)
async function isVehicleFree(vehicleId: string, start: Date, end: Date) {
  const overlaps = await db.query.bookings.findMany({
    where: (b, { and, gt, lt, lte, gte, or }) => and(
      eq(b.vehicleId, vehicleId),
      // overlap if (start < existing.end) && (end > existing.start)
      // emulate via SQL conditions:
      // start < endTs AND end > startTs
      // We'll use plain query below due to limited helpers
    ),
  });
  // Fallback: direct SQL due to condition building
  const rows = await db.execute(
    `select 1 from bookings 
     where vehicle_id = $1 
       and $2 < end_ts 
       and $3 > start_ts 
       and status in ('hold','confirmed','checked_out') 
     limit 1`,
    [vehicleId, start, end]
  );
  return rows.rowCount === 0;
}

// GET /api/bookings/quote
bookingsRouter.post("/quote", async (req, res, next) => {
  try {
    const { vehicleId, ratePlanId, startTs, endTs } = BookingQuote.parse(req.body ?? {});
    // fetch rate plan
    const [rp] = await db.select().from(ratePlans).where(eq(ratePlans.id, ratePlanId));
    if (!rp || !rp.active) return res.status(400).json({ error: "invalid_rate_plan" });

    const start = new Date(startTs);
    const end = new Date(endTs);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    const base = days >= 7 && rp.weeklyRate
      ? Math.ceil(days / 7) * rp.weeklyRate + (days % 7) * rp.dailyRate
      : days * rp.dailyRate;

    const deposit = rp.depositAmount;
    res.json({
      vehicleId, ratePlanId, startTs: start.toISOString(), endTs: end.toISOString(),
      days, base, deposit, currency: "KES"
    });
  } catch (e) { next(e); }
});

// POST /api/bookings  (create hold + customer)
bookingsRouter.post("/", async (req, res, next) => {
  try {
    const { customer, vehicleId, ratePlanId, startTs, endTs, notes } = BookingCreate.parse(req.body ?? {});
    // ensure vehicle and rate plan exist
    const [veh] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    if (!veh) return res.status(400).json({ error: "invalid_vehicle" });
    const [rp] = await db.select().from(ratePlans).where(eq(ratePlans.id, ratePlanId));
    if (!rp || !rp.active) return res.status(400).json({ error: "invalid_rate_plan" });

    const start = new Date(startTs);
    const end = new Date(endTs);
    const free = await isVehicleFree(vehicleId, start, end);
    if (!free) return res.status(409).json({ error: "vehicle_unavailable" });

    const custId = newId();
    await db.insert(customers).values({
      id: custId,
      fullName: customer.fullName,
      phoneE164: customer.phoneE164,
      email: customer.email ?? null
    });

    const bookingId = newId();
    const code = shortCode(6);
    await db.insert(bookings).values({
      id: bookingId,
      code,
      customerId: custId,
      vehicleId,
      ratePlanId,
      startTs: start,
      endTs: end,
      status: "hold",
      notes: notes ?? null
    });

    res.status(201).json({ id: bookingId, code, status: "hold" });
  } catch (e) { next(e); }
});

// POST /api/bookings/:id/confirm  (after deposit success)
bookingsRouter.post("/:id/confirm", async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await db.execute(
      `update bookings set status = 'confirmed' where id = $1 and status = 'hold'`,
      [id]
    );
    if (result.rowCount === 0) return res.status(400).json({ error: "bad_state_or_not_found" });
    res.json({ id, status: "confirmed" });
  } catch (e) { next(e); }
});
