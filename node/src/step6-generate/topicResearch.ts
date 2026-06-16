import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";

export type TopicResearchResearch = JsonObject & {
  keywords?: string[];
  articles?: string[];
  images?: string[];
  videos?: string[];
  core_points?: string[];
  writing_angles?: string[];
};

export type TopicResearchItem = {
  index?: number;
  topic_id: string;
  title: string;
  source_platform: string;
  source_url?: string;
  research: TopicResearchResearch;
};

export type TopicResearchArtifact = {
  schema_version: string;
  task_id: string;
  run_id: string;
  source_candidates_ref?: string;
  items: TopicResearchItem[];
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export function loadTopicResearchFile(filePath: string): TopicResearchArtifact {
  if (!fs.existsSync(filePath)) {
    throw new Error(`topic_research file not found: ${filePath}`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!isObject(raw)) throw new Error("topic_research must be a JSON object");
  const schema = typeof raw.schema_version === "string" ? raw.schema_version : "";
  if (!schema.startsWith("topic_research")) {
    throw new Error(`unexpected schema_version: ${schema || "(missing)"}`);
  }
  const task_id = typeof raw.task_id === "string" ? raw.task_id : "";
  const run_id = typeof raw.run_id === "string" ? raw.run_id : "";
  if (!task_id || !run_id) throw new Error("topic_research missing task_id or run_id");

  const itemsRaw = raw.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    throw new Error("topic_research.items is empty");
  }

  const items: TopicResearchItem[] = [];
  for (const row of itemsRaw) {
    if (!isObject(row)) continue;
    const topic_id = typeof row.topic_id === "string" ? row.topic_id : "";
    const title = typeof row.title === "string" ? row.title : "";
    const source_platform = typeof row.source_platform === "string" ? row.source_platform : "";
    const researchRaw = row.research;
    if (!topic_id || !title || !isObject(researchRaw)) {
      throw new Error("topic_research item missing topic_id, title, or research");
    }
    const research: TopicResearchResearch = {
      keywords: stringArray(researchRaw.keywords),
      articles: stringArray(researchRaw.articles),
      images: stringArray(researchRaw.images),
      videos: stringArray(researchRaw.videos),
      core_points: stringArray(researchRaw.core_points),
      writing_angles: stringArray(researchRaw.writing_angles),
    };
    const item: TopicResearchItem = { topic_id, title, source_platform, research };
    if (typeof row.index === "number") item.index = row.index;
    if (typeof row.source_url === "string" && row.source_url.trim()) item.source_url = row.source_url.trim();
    items.push(item);
  }

  const artifact: TopicResearchArtifact = { schema_version: schema, task_id, run_id, items };
  if (typeof raw.source_candidates_ref === "string") {
    artifact.source_candidates_ref = raw.source_candidates_ref;
  }
  return artifact;
}

export function resolveTopicResearchPath(task: JsonObject): string {
  const steps = task.steps;
  if (!isObject(steps)) throw new Error("task.steps missing");
  const approve = steps.approve;
  if (!isObject(approve)) throw new Error("steps.approve missing");
  const research = steps.research;
  const ref =
    (isObject(research) && typeof research.output_ref === "string" && research.output_ref) ||
    (typeof approve.research_ref === "string" && approve.research_ref) ||
    (typeof approve.output_ref === "string" && approve.output_ref) ||
    "";
  if (!ref || !ref.includes("topic_research")) {
    throw new Error(`steps.approve.research_ref must point to topic_research (got ${ref})`);
  }
  return ref;
}
