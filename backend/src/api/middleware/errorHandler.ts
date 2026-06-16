import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const errorHandler: ErrorHandler = (err, c) => {
  const status = (
    err instanceof HTTPException
      ? err.status
      : "status" in err && typeof err.status === "number"
        ? err.status
        : 500
  ) as ContentfulStatusCode;
  const message =
    err instanceof HTTPException
      ? err.message
      : err instanceof Error
        ? err.message
        : "Internal server error";

  if (status >= 500) {
    console.error("[dashboard]", err);
  }

  return c.json(
    {
      error: {
        code: status === 404 ? "NOT_FOUND" : status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
        message,
      },
    },
    status,
  );
};
