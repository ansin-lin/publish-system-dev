import fs from "node:fs";
import { Hono } from "hono";
import { loadOrchestratorSettings } from "../../../../node/src/orchestrator/config.js";
import { nowIsoJst } from "../../../../node/src/orchestrator/time.js";
import type { DashboardConfig } from "../../config/dashboardConfig.js";

function isReadable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function createHealthRoutes(dashboardConfig: DashboardConfig): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const settings = loadOrchestratorSettings();
    const publishConfig = settings.publishConfig;

    return c.json({
      ok: true,
      instance_name: publishConfig.instance_name,
      timezone: publishConfig.timezone,
      paths: {
        tasks_dir: settings.tasksDir,
        db_path: settings.dbPath,
        tasks_dir_readable: isReadable(settings.tasksDir),
        db_readable: isReadable(settings.dbPath),
        orchestrator_config: dashboardConfig.orchestratorConfigPath,
        openclaw_root: dashboardConfig.openclawRoot,
      },
      server_time: nowIsoJst(),
    });
  });

  return app;
}
