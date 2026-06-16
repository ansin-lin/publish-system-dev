import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { OutboxService } from "../../services/outboxService.js";

const querySchema = z.object({
  status: z.string().optional(),
  task_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export function createOutboxRoutes(outboxService: OutboxService): Hono {
  const app = new Hono();

  app.get("/outbox", zValidator("query", querySchema), (c) => {
    const query = c.req.valid("query");
    return c.json(
      outboxService.list({
        ...(query.status ? { status: query.status } : {}),
        ...(query.task_id ? { task_id: query.task_id } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      }),
    );
  });

  return app;
}
