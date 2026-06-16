import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { errorHandler } from "./api/middleware/errorHandler.js";
import { createDaysRoutes } from "./api/routes/days.js";
import { createHealthRoutes } from "./api/routes/health.js";
import { createOutboxRoutes } from "./api/routes/outbox.js";
import { createSystemRoutes } from "./api/routes/system.js";
import { createArtifactRoutes } from "./api/routes/artifacts.js";
import { createTaskRoutes } from "./api/routes/tasks.js";
import { createFrontendStaticMiddleware } from "./api/static/serveFrontend.js";
import { loadDashboardConfig } from "./config/dashboardConfig.js";
import { createArtifactService } from "./services/artifactService.js";
import { createOutboxService } from "./services/outboxService.js";
import { createSystemService } from "./services/systemService.js";
import { createTaskService } from "./services/taskService.js";
import { createTimelineService } from "./services/timelineService.js";

const dashboardConfig = loadDashboardConfig();

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: dashboardConfig.corsOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);
app.use("*", secureHeaders());

const taskService = createTaskService();
const timelineService = createTimelineService();
const outboxService = createOutboxService();
const systemService = createSystemService(dashboardConfig);
const artifactService = createArtifactService();

const api = new Hono();
api.route("/", createHealthRoutes(dashboardConfig));
api.route("/", createTaskRoutes(taskService, timelineService));
api.route("/", createArtifactRoutes(artifactService));
api.route("/", createDaysRoutes(taskService));
api.route("/", createOutboxRoutes(outboxService));
api.route("/", createSystemRoutes(systemService));

app.route("/api", api);

if (dashboardConfig.serveFrontend) {
  app.use("*", createFrontendStaticMiddleware(dashboardConfig.frontendDistDir));
  console.log(`[dashboard] serving frontend: ${dashboardConfig.frontendDistDir}`);
}

app.notFound((c) => {
  if (c.req.path.startsWith("/api")) {
    return c.json({ error: { code: "NOT_FOUND", message: `No route for ${c.req.path}` } }, 404);
  }
  return c.text("Not Found", 404);
});

app.onError(errorHandler);

const port = dashboardConfig.port;

console.log(`[dashboard] publish-system root: ${dashboardConfig.publishSystemRoot}`);
console.log(`[dashboard] listening on http://${dashboardConfig.hostname}:${port}`);

serve({ fetch: app.fetch, port, hostname: dashboardConfig.hostname });
