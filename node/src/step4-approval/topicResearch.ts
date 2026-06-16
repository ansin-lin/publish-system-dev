import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import { nowIsoJst, yyyymmddJst } from "../orchestrator/time.js";
import type { PickListTopic } from "./slackNotify.js";
import {
  runContentResearchRole,
  type ContentResearchInput,
} from "./researchRoleDispatch.js";

export type TopicResearchItem = PickListTopic & {
  research: JsonObject;
};

export async function buildTopicResearchItems(
  selected: PickListTopic[],
  taskId: string,
  runId: string,
  collectHints: Map<string, string>,
): Promise<TopicResearchItem[]> {
  const out: TopicResearchItem[] = [];
  for (const row of selected) {
    const roleInput: ContentResearchInput = {
      title: row.title,
      topic_id: row.topic_id,
      task_id: taskId,
      run_id: runId,
    };
    if (row.source_platform) roleInput.source_platform = row.source_platform;
    if (row.source_url) roleInput.source_url = row.source_url;
    const hintKey = `${row.topic_id}\0${row.source_platform}`;
    const hint = collectHints.get(hintKey);
    if (hint) roleInput.collect_hint = hint;

    const research = await runContentResearchRole(roleInput);
    out.push({ ...row, research });
  }
  return out;
}

export function writeTopicResearchFile(params: {
  approveDir: string;
  taskId: string;
  runId: string;
  operator: string;
  candidatesPath: string;
  selectedTopicsPath: string;
  selectedIndices: number[];
  items: TopicResearchItem[];
}): string {
  const datePart = yyyymmddJst();
  const outName = `topic_research_${datePart}_${params.runId}.json`;
  const outputPath = path.resolve(params.approveDir, outName);

  const artifact: JsonObject = {
    schema_version: "topic_research.v1",
    generated_at: nowIsoJst(),
    task_id: params.taskId,
    run_id: params.runId,
    selected_by: params.operator,
    selected_at: nowIsoJst(),
    source_candidates_ref: params.candidatesPath,
    source_selected_topics_ref: params.selectedTopicsPath,
    selected_indices: [...params.selectedIndices],
    items: params.items.map((t) => {
      const row: JsonObject = {
        index: t.index,
        topic_id: t.topic_id,
        title: t.title,
        source_platform: t.source_platform,
        research: t.research,
      };
      if (t.source_url) row.source_url = t.source_url;
      if (t.score !== undefined) row.score = t.score;
      return row;
    }),
  };

  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2), "utf-8");
  return outputPath;
}

export function collectHintsFromCollectItems(collectPath: string | null): Map<string, string> {
  const hints = new Map<string, string>();
  if (!collectPath || !fs.existsSync(collectPath)) return hints;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(collectPath, "utf8")) as unknown;
  } catch {
    return hints;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return hints;
  const items = (raw as JsonObject).items;
  if (!Array.isArray(items)) return hints;
  for (const it of items) {
    if (!it || typeof it !== "object" || Array.isArray(it)) continue;
    const row = it as JsonObject;
    const topic_id = typeof row.topic_id === "string" ? row.topic_id : "";
    const platform = typeof row.source_platform === "string" ? row.source_platform : "";
    if (!topic_id) continue;
    const title = typeof row.title === "string" ? row.title : "";
    const snippet = typeof row.snippet === "string" ? row.snippet : "";
    const text = [title, snippet].filter(Boolean).join(" — ").slice(0, 800);
    if (text) hints.set(`${topic_id}\0${platform}`, text);
  }
  return hints;
}
