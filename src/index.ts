// src/index.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ENV } from "./env";
import { health } from "./routes/health";
import { vehiclesRouter } from "./routes/vehicles";
import { ratePlansRouter } from "./routes/rateplans";
import { bookingsRouter } from "./routes/bookings";
import { paymentsRouter } from "./routes/payments";
import { pool } from "./db/drizzle";

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));

app.use("/health", health);
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/rate-plans", ratePlansRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/payments", paymentsRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: "internal_error", detail: String(err?.message ?? err) });
});

app.listen(ENV.PORT, () => {
  console.log(`🚗 carhire api on http://localhost:${ENV.PORT}`);
});

process.on("SIGINT", async () => { await pool.end(); process.exit(0); });
