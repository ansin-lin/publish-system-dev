import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { SystemService } from "../../services/systemService.js";

const dateSchema = z.object({
  date: z.string().regex(/^(\d{8}|\d{4}-\d{2}-\d{2})$/).optional(),
});

export function createSystemRoutes(systemService: SystemService): Hono {
  const app = new Hono();

  app.get("/system/cron", (c) => c.json(systemService.getCronStatus()));

  app.get("/system/dispatch-log", zValidator("query", dateSchema), (c) => {
    const { date } = c.req.valid("query");
    try {
      return c.json(systemService.getDispatchLog(date));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid date";
      throw new HTTPException(400, { message });
    }
  });

  return app;
}
