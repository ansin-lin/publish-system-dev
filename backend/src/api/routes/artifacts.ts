import fs from "node:fs";
import path from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { ArtifactService } from "../../services/artifactService.js";
import { ARTIFACT_PAGE_MAX } from "../../services/artifactService.js";
import { assertReadableFile } from "../../utils/pathGuard.js";

const artifactStepSchema = z.object({
  taskId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9._-]+$/),
  step: z.enum(["collect", "tidy", "approve", "generate", "publish"]),
});

const artifactQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  section: z.enum(["selected", "research", "copy", "image"]).optional(),
});

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
};

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

export function createArtifactRoutes(artifactService: ArtifactService): Hono {
  const app = new Hono();

  app.get(
    "/tasks/:taskId/artifacts/:step",
    zValidator("param", artifactStepSchema),
    zValidator("query", artifactQuerySchema),
    (c) => {
      const { taskId, step } = c.req.valid("param");
      const query = c.req.valid("query");
      const pageQuery =
        query.limit !== undefined || query.offset !== undefined || query.section
          ? {
              limit: query.limit ?? ARTIFACT_PAGE_MAX,
              offset: query.offset ?? 0,
              ...(query.section ? { section: query.section } : {}),
            }
          : undefined;
      const artifact = artifactService.getArtifact(taskId, step, pageQuery);
      if (!artifact) {
        throw new HTTPException(404, { message: `Task not found: ${taskId}` });
      }
      return c.json(artifact);
    },
  );

  app.get(
    "/tasks/:taskId/files/:filepath{.+}",
    zValidator(
      "param",
      z.object({
        taskId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9._-]+$/),
        filepath: z.string().min(1),
      }),
    ),
    (c) => {
    const { taskId, filepath } = c.req.valid("param");
    const decoded = filepath.split("/").map(decodeURIComponent).join("/");
    const abs = artifactService.resolveTaskFile(taskId, decoded);
    if (!abs) {
      throw new HTTPException(404, { message: "File not found" });
    }
    try {
      assertReadableFile(abs);
    } catch {
      throw new HTTPException(404, { message: "File not found" });
    }
    const data = fs.readFileSync(abs);
    return c.body(data, 200, { "Content-Type": contentType(abs), "Cache-Control": "private, max-age=60" });
    },
  );

  return app;
}
