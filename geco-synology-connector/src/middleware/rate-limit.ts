import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { env } from "../config/env.js";

export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    allowList: () => false,
    keyGenerator: (req) => {
      const id = req.headers["x-geco-connector-id"];
      return typeof id === "string" ? id : req.ip;
    },
  });
}
