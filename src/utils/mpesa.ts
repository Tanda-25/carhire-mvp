// src/utils/mpesa.ts
// Minimal Daraja STK client (production-ready structure, sandbox-safe).
import { ENV } from "../env";

type OAuthResponse = { access_token: string; expires_in: string };

// Build base64 password: Shortcode + Passkey + Timestamp (yyyyMMddHHmmss)
function mpesaPassword(ts: string) {
  const raw = `${ENV.MPESA.SHORTCODE}${ENV.MPESA.PASSKEY}${ts}`;
  return Buffer.from(raw).toString("base64");
}

export async function getOAuthToken(): Promise<string> {
  const key = ENV.MPESA.CONSUMER_KEY;
  const secret = ENV.MPESA.CONSUMER_SECRET;
  if (!key || !secret) throw new Error("MPesa consumer key/secret missing");
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");

  const url = "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`OAuth failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as OAuthResponse;
  return data.access_token;
}

export async function stkPush({
  phoneE164,
  amount,
  accountRef,
  bookingId,
}: {
  phoneE164: string;
  amount: number;
  accountRef: string;   // e.g., booking code
  bookingId: string;    // for metadata
}) {
  const token = await getOAuthToken();

  // Daraja wants: timestamp yyyymmddHHMMss and sanitized phone (MSISDN)
  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;

  const payload = {
    BusinessShortCode: Number(ENV.MPESA.SHORTCODE),
    Password: mpesaPassword(timestamp),
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phoneToMSISDN(phoneE164),
    PartyB: Number(ENV.MPESA.SHORTCODE),
    PhoneNumber: phoneToMSISDN(phoneE164),
    CallBackURL: ENV.MPESA.CALLBACK_URL,
    AccountReference: accountRef.slice(0, 12),
    TransactionDesc: `Booking ${bookingId}`,
  };

  const url = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data: any = await safeJson(res);
  if (!res.ok) {
    throw new Error(`STK error: ${res.status} ${JSON.stringify(data)}`);
  }
  // Typical response has CheckoutRequestID & MerchantRequestID
  return data;
}

export function phoneToMSISDN(e164: string) {
  // Accept +2547xxxxxxx or 2547xxxxxxx; ensure 254 prefix
  const digits = e164.replace(/[^\d]/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7")) return `254${digits}`;
  if (e164.startsWith("+")) return digits; // assume already intl
  return digits;
}

async function safeJson(res: Response) {
  try { return await res.json(); } catch { return await res.text(); }
}
