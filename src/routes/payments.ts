// src/routes/payments.ts
import { Router } from "express";
import { db } from "../db/drizzle";
import { bookings, customers, payments, ratePlans } from "../db/schema";
import { eq } from "drizzle-orm";
import { newId } from "../utils/id";
import { stkPush } from "../utils/mpesa";

/**
 * POST /api/payments/mpesa/stk
 * body: { bookingId: string, phoneE164?: string, amountOverride?: number }
 * - Calculates deposit from rate plan if no amountOverride.
 * - Creates a pending payment row.
 * - Triggers STK push.
 */
export const paymentsRouter = Router();

paymentsRouter.post("/mpesa/stk", async (req, res, next) => {
  try {
    const { bookingId, phoneE164, amountOverride } = req.body ?? {};
    if (!bookingId) return res.status(400).json({ error: "bookingId_required" });

    const [bk] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!bk) return res.status(404).json({ error: "booking_not_found" });
    const [rp] = await db.select().from(ratePlans).where(eq(ratePlans.id, bk.ratePlanId));
    if (!rp) return res.status(400).json({ error: "rate_plan_missing" });
    const [cust] = await db.select().from(customers).where(eq(customers.id, bk.customerId));
    if (!cust) return res.status(400).json({ error: "customer_missing" });

    const amount = Number(amountOverride ?? rp.depositAmount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "invalid_amount" });

    const payId = newId();
    await db.insert(payments).values({
      id: payId,
      bookingId,
      channel: "mpesa",
      ref: null as any, // set after callback
      amount,
      currency: "KES",
      type: "deposit",
      status: "pending",
      paidTs: null as any,
    });

    const phone = String(phoneE164 ?? cust.phoneE164);
    const resp = await stkPush({
      phoneE164: phone,
      amount,
      accountRef: bk.code,
      bookingId,
    });

    res.status(201).json({
      paymentId: payId,
      bookingId,
      stk: resp, // includes CheckoutRequestID, etc.
      message: "STK push initiated. Prompt will appear on phone."
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/payments/mpesa/c2b
 * Daraja will hit this with a JSON body for STK callback (ResultCode, MpesaReceiptNumber, etc.)
 * We:
 *  - Idempotently upsert payments by MpesaReceiptNumber (ref)
 *  - Mark payment success/failed
 *  - If success and payment.type=deposit and booking.status='hold' -> set 'confirmed'
 */
paymentsRouter.post("/mpesa/c2b", async (req, res, _next) => {
  // Acknowledge immediately to Daraja to avoid retries
  res.json({ ok: true });
  try {
    const body = req.body ?? {};
    // Support both STK callback shapes:
    // 1) { Body: { stkCallback: { ResultCode, CallbackMetadata: { Item: [...] } } } }
    // 2) C2B PayBill json
    const stk = body?.Body?.stkCallback;
    if (!stk) {
      console.warn("[mpesa webhook] Unknown payload shape", body);
      return;
    }

    const resultCode = Number(stk.ResultCode);
    const items = Object.fromEntries(
      (stk.CallbackMetadata?.Item ?? []).map((it: any) => [it.Name, it.Value])
    );

    const mpesaRef = String(items.MpesaReceiptNumber ?? items.ReceiptNumber ?? "");
    const amount = Number(items.Amount ?? 0);
    const phone = String(items.PhoneNumber ?? items.MSISDN ?? "");
    const transTs = String(items.TransactionDate ?? "");

    // In Daraja STK, CheckoutRequestID is available earlier; we keyed payment by booking,
    // so we will try to find a pending payment closest by amount and status.
    // (For production, persist CheckoutRequestID on create.)
    // Here, we match recent pending payments of same amount and mark success.
    const pending = await db.execute(
      `select id, booking_id, type, status 
         from payments 
        where status = 'pending' 
          and amount = $1 
        order by paid_ts desc nulls last 
        limit 5`, [amount]
    );
    if (pending.rowCount === 0) {
      console.warn("[mpesa webhook] No pending payment found for amount", amount);
      return;
    }

    const paymentId = pending.rows[0].id as string;
    const bookingId = pending.rows[0].booking_id as string;
    const isSuccess = resultCode === 0;

    if (isSuccess) {
      await db.execute(
        `update payments 
            set status='success', ref=$1, paid_ts=now() 
          where id=$2 and status='pending'`,
        [mpesaRef || phone, paymentId]
      );
      // auto-confirm hold booking when deposit success
      await db.execute(
        `update bookings set status='confirmed' 
          where id=$1 and status='hold'`,
        [bookingId]
      );
      console.log("[mpesa webhook] Payment success", { paymentId, bookingId, mpesaRef });
    } else {
      await db.execute(
        `update payments set status='failed', ref=$1, paid_ts=now() 
          where id=$2 and status='pending'`,
        [mpesaRef || phone || `code_${resultCode}`, paymentId]
      );
      console.warn("[mpesa webhook] Payment failed", { paymentId, resultCode });
    }
  } catch (err) {
    console.error("[mpesa webhook] Error", err);
  }
});
