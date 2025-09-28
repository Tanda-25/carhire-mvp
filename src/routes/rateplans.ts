// src/routes/rateplans.ts
import { Router } from "express";
import { db } from "../db/drizzle";
import { ratePlans } from "../db/schema";
import { newId } from "../utils/id";
import { RatePlanCreate } from "../validators/ratePlans";
import { eq } from "drizzle-orm";

export const ratePlansRouter = Router();

// list active rate plans
ratePlansRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(ratePlans);
  res.json(rows);
});

// create
ratePlansRouter.post("/", async (req, res, next) => {
  try {
    const input = RatePlanCreate.parse(req.body ?? {});
    const row = {
      id: newId(),
      ...input
    };
    await db.insert(ratePlans).values(row);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// toggle active
ratePlansRouter.post("/:id/toggle", async (req, res, next) => {
  try {
    const id = req.params.id;
    const [rp] = await db.select().from(ratePlans).where(eq(ratePlans.id, id));
    if (!rp) return res.status(404).json({ error: "not_found" });
    await db.update(ratePlans).set({ active: !rp.active }).where(eq(ratePlans.id, id));
    res.json({ id, active: !rp.active });
  } catch (e) { next(e); }
});
