// src/routes/bookings.ts
import { Router } from "express";
import { db } from "../db/drizzle";
import { bookings, customers, vehicles, ratePlans, inspections } from "../db/schema";
import { eq } from "drizzle-orm";
import { BookingQuote, BookingCreate } from "../validators/bookings";
import { newId, shortCode } from "../utils/id";
import { InspectionInput } from "../validators/inspections";

export const bookingsRouter = Router();

// ── Utility: is vehicle free in the window ────────────────────────────────────
async function isVehicleFree(vehicleId: string, start: Date, end: Date) {
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

// ── POST /api/bookings/quote ─────────────────────────────────────────────────
bookingsRouter.post("/quote", async (req, res, next) => {
  try {
    const { vehicleId, ratePlanId, startTs, endTs } = BookingQuote.parse(req.body ?? {});
    const [rp] = await db.select().from(ratePlans).where(eq(ratePlans.id, ratePlanId));
    if (!rp || !rp.active) return res.status(400).json({ error: "invalid_rate_plan" });

    const start = new Date(startTs);
    const end = new Date(endTs);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

    const base = days >= 7 && rp.weeklyRate
      ? Math.floor(days / 7) * rp.weeklyRate + (days % 7) * rp.dailyRate
      : days * rp.dailyRate;

    res.json({
      vehicleId, ratePlanId, startTs: start.toISOString(), endTs: end.toISOString(),
      days, base, deposit: rp.depositAmount, currency: "KES"
    });
  } catch (e) { next(e); }
});

// ── POST /api/bookings (create hold) ─────────────────────────────────────────
bookingsRouter.post("/", async (req, res, next) => {
  try {
    const { customer, vehicleId, ratePlanId, startTs, endTs, notes } = BookingCreate.parse(req.body ?? {});

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

// ── POST /api/bookings/:id/confirm (after deposit) ───────────────────────────
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

// ── GET /api/bookings/by-code/:code  (agent convenience) ─────────────────────
bookingsRouter.get("/by-code/:code", async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    const row = await db.execute(
      `select b.*, c.full_name, c.phone_e164, v.plate
         from bookings b
         join customers c on c.id = b.customer_id
         join vehicles v on v.id = b.vehicle_id
        where b.code = $1`,
      [code]
    );
    if (row.rowCount === 0) return res.status(404).json({ error: "not_found" });
    res.json(row.rows[0]);
  } catch (e) { next(e); }
});

// ── POST /api/bookings/:id/check-out  (handover) ─────────────────────────────
bookingsRouter.post("/:id/check-out", async (req, res, next) => {
  try {
    const id = req.params.id;
    const [bk] = await db.select().from(bookings).where(eq(bookings.id, id));
    if (!bk) return res.status(404).json({ error: "not_found" });
    if (!["confirmed"].includes(bk.status)) {
      return res.status(400).json({ error: "bad_state", detail: "must be confirmed before check-out" });
    }

    const input = InspectionInput.parse(req.body ?? {});
    const inspId = newId();
    await db.insert(inspections).values({
      id: inspId,
      bookingId: id,
      type: "checkout",
      odoKm: input.odoKm,
      fuelLevel: input.fuelLevel,
      photos: input.photos,
      checklist: input.checklist,
      notes: input.notes ?? null
    });

    await db.execute(`update bookings set status = 'checked_out' where id = $1`, [id]);
    res.json({ id, status: "checked_out", inspectionId: inspId });
  } catch (e) { next(e); }
});

// ── POST /api/bookings/:id/check-in  (return) ────────────────────────────────
bookingsRouter.post("/:id/check-in", async (req, res, next) => {
  try {
    const id = req.params.id;
    const [bk] = await db.select().from(bookings).where(eq(bookings.id, id));
    if (!bk) return res.status(404).json({ error: "not_found" });
    if (!["checked_out"].includes(bk.status)) {
      return res.status(400).json({ error: "bad_state", detail: "must be checked_out before check-in" });
    }

    const input = InspectionInput.parse(req.body ?? {});
    const inspId = newId();
    await db.insert(inspections).values({
      id: inspId,
      bookingId: id,
      type: "checkin",
      odoKm: input.odoKm,
      fuelLevel: input.fuelLevel,
      photos: input.photos,
      checklist: input.checklist,
      notes: input.notes ?? null
    });

    await db.execute(`update bookings set status = 'returned' where id = $1`, [id]);
    res.json({ id, status: "returned", inspectionId: inspId });
  } catch (e) { next(e); }
});
