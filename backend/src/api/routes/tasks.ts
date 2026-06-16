import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { TaskService } from "../../services/taskService.js";
import type { TimelineService } from "../../services/timelineService.js";

const taskIdSchema = z.object({
  taskId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9._-]+$/, "Invalid task_id format"),
});

export function createTaskRoutes(taskService: TaskService, timelineService: TimelineService): Hono {
  const app = new Hono();

  app.get("/tasks/:taskId/timeline", zValidator("param", taskIdSchema), (c) => {
    const { taskId } = c.req.valid("param");
    const timeline = timelineService.getTimeline(taskId);
    if (!timeline) {
      throw new HTTPException(404, { message: `Task not found: ${taskId}` });
    }
    return c.json(timeline);
  });

  app.get("/tasks/:taskId", zValidator("param", taskIdSchema), (c) => {
    const { taskId } = c.req.valid("param");
    const task = taskService.getById(taskId);
    if (!task) {
      throw new HTTPException(404, { message: `Task not found: ${taskId}` });
    }
    return c.json(task);
  });

  return app;
}
