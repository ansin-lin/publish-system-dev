import {
  getMaxStaleRollbacksPerStepPerDay,
  getStaleExcludedStatuses,
  getStaleThresholdMs,
} from "./publishOrchestratorConfig.js";

/** @deprecated use getStaleThresholdMs(step) — kept for imports */
export const DEFAULT_STALE_THRESHOLD_MS = 60 * 60 * 1000;

export { getStaleThresholdMs, getStaleExcludedStatuses, getMaxStaleRollbacksPerStepPerDay };
