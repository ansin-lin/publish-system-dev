import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { TaskService } from "../../services/taskService.js";

const ymdSchema = z.string().regex(/^(\d{8}|\d{4}-\d{2}-\d{2})$/, "Use YYYYMMDD or YYYY-MM-DD");

const daysQuerySchema = z.object({
  from: ymdSchema.optional(),
  to: ymdSchema.optional(),
});

export function createDaysRoutes(taskService: TaskService): Hono {
  const app = new Hono();

  app.get("/days", zValidator("query", daysQuerySchema), (c) => {
    const query = c.req.valid("query");
    try {
      const to = taskService.resolveDateYmd(query.to);
      const from = taskService.resolveDateYmd(query.from ?? to);
      const days = taskService.listDays(from, to);
      return c.json({ days });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid date range";
      throw new HTTPException(400, { message });
    }
  });

  app.get("/days/:date/tasks", zValidator("param", z.object({ date: ymdSchema })), (c) => {
    const { date } = c.req.valid("param");
    try {
      const ymd = taskService.resolveDateYmd(date);
      const tasks = taskService.listTasksForDate(ymd);
      return c.json({ date: ymd, tasks });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid date";
      throw new HTTPException(400, { message });
    }
  });

  app.get("/days/:date/primary", zValidator("param", z.object({ date: ymdSchema })), (c) => {
    const { date } = c.req.valid("param");
    try {
      const ymd = taskService.resolveDateYmd(date);
      const task = taskService.getPrimaryForDate(ymd);
      if (!task) {
        return c.json({ date: ymd, task: null });
      }
      return c.json({ date: ymd, task });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid date";
      throw new HTTPException(400, { message });
    }
  });

  return app;
}
