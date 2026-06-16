/**
 * Patch task.json after topic_research is written (uses orchestrator updateTask + outbox).
 * Invoked from run.mjs; not part of publish-system/node CLI surface.
 */
import { loadOrchestratorSettings } from "../../node/src/orchestrator/config.js";
import { mergeStep } from "../../node/src/orchestrator/taskMutations.js";
import { loadTaskJson, taskJsonPath } from "../../node/src/orchestrator/taskStore.js";
import { updateTask } from "../../node/src/orchestrator/updateTask.js";

function parseArgs(argv: string[]) {
  let taskId = "";
  let researchRef = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--task-id") taskId = argv[++i] ?? "";
    else if (argv[i] === "--research-ref") researchRef = argv[++i] ?? "";
  }
  if (!taskId || !researchRef) {
    throw new Error("Usage: patchTaskResearchRef.ts --task-id <id> --research-ref <absolute path>");
  }
  return { taskId, researchRef };
}

async function main() {
  const { taskId, researchRef } = parseArgs(process.argv.slice(2));
  const settings = loadOrchestratorSettings();
  const tpath = taskJsonPath(settings, taskId);
  const before = loadTaskJson(tpath);
  const prevRef =
    typeof before.steps === "object" &&
    before.steps !== null &&
    !Array.isArray(before.steps) &&
    typeof (before.steps as Record<string, unknown>).approve === "object"
      ? String(
          (
            (before.steps as Record<string, unknown>).approve as Record<string, unknown>
          ).research_ref ?? "",
        )
      : "";

  if (prevRef === researchRef) {
    console.log(JSON.stringify({ ok: true, skipped: true, research_ref: researchRef }, null, 2));
    return;
  }

  const result = await updateTask(
    {
      taskJsonPath: tpath,
      reason: "topic_research_ref_updated",
      operator: "content-research-tool",
      changedFields: ["steps.approve.research_ref"],
      payload: { research_ref: researchRef },
      mutate: (draft, context) => {
        mergeStep(draft, "approve", {
          research_ref: researchRef,
          topic_research_at: context.now,
        });
      },
    },
    settings,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        task_id: taskId,
        research_ref: researchRef,
        revision: result.task.revision,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
