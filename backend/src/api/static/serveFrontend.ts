import fs from "node:fs";
import path from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { resolveUnderBase } from "../../utils/pathGuard.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function guessMime(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function createFrontendStaticMiddleware(distDir: string): MiddlewareHandler {
  const root = path.resolve(distDir);
  const indexPath = path.join(root, "index.html");
  const enabled = fs.existsSync(indexPath);

  return async (c: Context, next) => {
    if (!enabled) return next();
    if (c.req.path.startsWith("/api")) return next();

    const urlPath = c.req.path === "/" ? "index.html" : c.req.path.replace(/^\//, "");
    let filePath = resolveUnderBase(root, urlPath);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = indexPath;
    }

    const body = fs.readFileSync(filePath);
    return c.body(body, 200, { "Content-Type": guessMime(filePath) });
  };
}

export function isFrontendDistReady(distDir: string): boolean {
  return fs.existsSync(path.join(path.resolve(distDir), "index.html"));
}
