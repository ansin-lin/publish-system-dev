/**
 * Verifies transitionGuard allows every status edge used by the orchestrator pipeline.
 * Run: npx tsx src/scripts/audit-pipeline-transitions.ts
 */
import { assertValidTransition } from "../orchestrator/transitionGuard.js";

/** Edges exercised by Step1–7 (r01/r02/r03 share the same pipeline). */
const REQUIRED_EDGES: Array<[string, string]> = [
  ["created", "collecting"],
  ["collecting", "collected"],
  ["collected", "awaiting_manager_selection"],
  ["awaiting_manager_selection", "topics_selected"],
  ["awaiting_manager_selection", "approval_timeout"],
  ["topics_selected", "generating_research"],
  ["generating_research", "research_done"],
  ["generating_research", "topics_selected"],
  ["research_done", "generating_copy"],
  ["generating_copy", "copy_generated"],
  ["generating_copy", "research_done"],
  ["copy_generated", "generating_image"],
  ["generating_image", "image_generated"],
  ["generating_image", "copy_generated"],
  ["image_generated", "publishing"],
  ["publishing", "published"],
  ["publishing", "publish_partial_failed"],
  ["publish_partial_failed", "publishing"],
  ["publish_partial_failed", "image_generated"],
];

let failed = 0;
for (const [from, to] of REQUIRED_EDGES) {
  try {
    assertValidTransition(from, to);
  } catch (e) {
    failed += 1;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`MISSING: ${from} -> ${to}: ${msg}`);
  }
}

if (failed > 0) {
  console.error(`audit-pipeline-transitions: ${failed} missing edge(s)`);
  process.exit(1);
}

console.log(`audit-pipeline-transitions: OK (${REQUIRED_EDGES.length} edges)`);
