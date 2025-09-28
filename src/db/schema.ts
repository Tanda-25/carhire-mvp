// src/db/schema.ts
import {
  pgTable, varchar, integer, timestamp, boolean, numeric, text
} from "drizzle-orm/pg-core";

export const customers = pgTable("customers", {
  id: varchar("id", { length: 26 }).primaryKey(),
  fullName: varchar("full_name", { length: 120 }).notNull(),
  phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
  email: varchar("email", { length: 160 }),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

export const vehicles = pgTable("vehicles", {
  id: varchar("id", { length: 26 }).primaryKey(),
  plate: varchar("plate", { length: 16 }).notNull().unique(),
  make: varchar("make", { length: 40 }),
  model: varchar("model", { length: 40 }),
  year: integer("year"),
  color: varchar("color", { length: 30 }),
  odoKm: integer("odo_km").default(0).notNull(),
  status: varchar("status", { length: 20 }).default("available").notNull() // available|booked|out|service
});

export const ratePlans = pgTable("rate_plans", {
  id: varchar("id", { length: 26 }).primaryKey(),
  name: varchar("name", { length: 60 }).notNull(),
  dailyRate: integer("daily_rate").notNull(),
  weeklyRate: integer("weekly_rate"),
  depositAmount: integer("deposit_amount").notNull(),
  kmIncludedPerDay: integer("km_included_per_day").default(150).notNull(),
  extraKmRate: integer("extra_km_rate").default(0).notNull(),
  weekendMultiplier: numeric("weekend_multiplier", { precision: 4, scale: 2 }).default("1.00").notNull(),
  active: boolean("active").default(true).notNull()
});

export const bookings = pgTable("bookings", {
  id: varchar("id", { length: 26 }).primaryKey(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  customerId: varchar("customer_id", { length: 26 }).notNull(),
  vehicleId: varchar("vehicle_id", { length: 26 }).notNull(),
  ratePlanId: varchar("rate_plan_id", { length: 26 }).notNull(),
  startTs: timestamp("start_ts", { withTimezone: false }).notNull(),
  endTs: timestamp("end_ts", { withTimezone: false }).notNull(),
  status: varchar("status", { length: 20 }).default("hold").notNull(), // hold|confirmed|checked_out|returned|closed|canceled
  notes: text("notes")
});

export const payments = pgTable("payments", {
  id: varchar("id", { length: 26 }).primaryKey(),
  bookingId: varchar("booking_id", { length: 26 }).notNull(),
  channel: varchar("channel", { length: 20 }).notNull(), // mpesa
  ref: varchar("ref", { length: 64 }),
  amount: integer("amount").notNull(),
  currency: varchar("currency", { length: 8 }).default("KES").notNull(),
  type: varchar("type", { length: 20 }).notNull(), // deposit|rental|refund
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending|success|failed
  paidTs: timestamp("paid_ts", { withTimezone: false })
});
