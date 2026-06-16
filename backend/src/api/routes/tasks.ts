import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { TaskService } from "../../services/taskService.js";
import type { TimelineService } from "../../services/timelineService.js";
import type { PublishReviewService } from "../../services/publishReviewService.js";

const taskIdSchema = z.object({
  taskId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9._-]+$/, "Invalid task_id format"),
});

export function createTaskRoutes(
  taskService: TaskService,
  timelineService: TimelineService,
  publishReviewService: PublishReviewService,
): Hono {
  const app = new Hono();

  app.get("/tasks/pending-publish-review", (c) => {
    return c.json({ tasks: taskService.listPendingPublishReview() });
  });

  app.get("/tasks/:taskId/timeline", zValidator("param", taskIdSchema), (c) => {
    const { taskId } = c.req.valid("param");
    const timeline = timelineService.getTimeline(taskId);
    if (!timeline) {
      throw new HTTPException(404, { message: `Task not found: ${taskId}` });
    }
    return c.json(timeline);
  });

  app.get("/tasks/:taskId/publish-review", zValidator("param", taskIdSchema), (c) => {
    const { taskId } = c.req.valid("param");
    if (!taskService.getById(taskId)) {
      throw new HTTPException(404, { message: `Task not found: ${taskId}` });
    }
    return c.json(publishReviewService.getContext(taskId));
  });

  app.post(
    "/tasks/:taskId/approve-publish",
    zValidator("param", taskIdSchema),
    zValidator(
      "json",
      z.object({
        action: z.enum(["approve", "reject"]),
      }),
    ),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { action } = c.req.valid("json");
      if (!taskService.getById(taskId)) {
        throw new HTTPException(404, { message: `Task not found: ${taskId}` });
      }
      try {
        const result = await publishReviewService.approve(taskId, action);
        return c.json({ ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new HTTPException(400, { message });
      }
    },
  );

  app.post(
    "/tasks/:taskId/regenerate-copy",
    zValidator("param", taskIdSchema),
    zValidator(
      "json",
      z.object({
        platforms: z.array(z.string().min(1)).min(1),
        feedback: z.string().min(1).max(4000),
      }),
    ),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const body = c.req.valid("json");
      if (!taskService.getById(taskId)) {
        throw new HTTPException(404, { message: `Task not found: ${taskId}` });
      }
      try {
        const result = await publishReviewService.regenerateCopy(
          taskId,
          body.platforms,
          body.feedback,
        );
        return c.json({ ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new HTTPException(400, { message });
      }
    },
  );

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
