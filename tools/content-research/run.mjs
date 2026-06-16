#!/usr/bin/env node
/**
 * Standalone Step4c: read Step4 outputs → content-research agent → topic_research.v1
 * Does NOT modify publish-system/node orchestrator code.
 *
 * Prerequisites: openclaw gateway running; GOOGLE_API_KEY or agent auth configured.
 *
 * Usage:
 *   node tools/content-research/run.mjs --task-id daily-20260519-r01
 *   node tools/content-research/run.mjs --selected-topics path/to/selected_topics_*.json
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLISH_ROOT = path.resolve(__dirname, "..", "..");
const TASKS_DIR = path.join(PUBLISH_ROOT, "data", "tasks");

const RESEARCH_KEYS = [
  "keywords",
  "articles",
  "images",
  "videos",
  "core_points",
  "writing_angles",
];

function parseArgs(argv) {
  const out = { taskId: "", selectedTopics: "", force: false, agentId: "content-research" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--task-id") out.taskId = argv[++i] ?? "";
    else if (a === "--selected-topics") out.selectedTopics = argv[++i] ?? "";
    else if (a === "--force") out.force = true;
    else if (a === "--agent") out.agentId = argv[++i] ?? "content-research";
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function extractJsonText(content) {
  const trimmed = String(content).trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveSelectedTopicsPath(taskId, explicit) {
  if (explicit) return path.resolve(explicit);
  if (!taskId) throw new Error("Need --task-id or --selected-topics");

  const taskJson = path.join(TASKS_DIR, taskId, "task.json");
  if (fs.existsSync(taskJson)) {
    const task = readJson(taskJson);
    const approve = task.steps?.approve;
    const ref = typeof approve?.output_ref === "string" ? approve.output_ref : "";
    if (ref.includes("selected_topics") && fs.existsSync(ref)) return ref;
  }

  const approveDir = path.join(TASKS_DIR, taskId, "approve");
  if (!fs.existsSync(approveDir)) throw new Error(`No approve dir: ${approveDir}`);
  const files = fs
    .readdirSync(approveDir)
    .filter((f) => f.startsWith("selected_topics_") && f.endsWith(".json"))
    .sort();
  if (!files.length) {
    throw new Error(
      `No selected_topics_*.json under ${approveDir}. Run submit-pick first.`,
    );
  }
  return path.join(approveDir, files[files.length - 1]);
}

function findCollectItemsPath(taskId, selectedDoc) {
  const approveDir = path.join(TASKS_DIR, taskId, "approve");
  const taskJson = path.join(TASKS_DIR, taskId, "task.json");
  if (fs.existsSync(taskJson)) {
    const task = readJson(taskJson);
    const ref = task.steps?.approve?.collect_items_ref;
    if (typeof ref === "string" && fs.existsSync(ref)) return ref;
  }
  if (!fs.existsSync(approveDir)) return null;
  const files = fs
    .readdirSync(approveDir)
    .filter((f) => f.startsWith("selected_collect_items_") && f.endsWith(".json"));
  return files.length ? path.join(approveDir, files.sort().at(-1)) : null;
}

function collectHintForTopic(collectDoc, topicId, platform) {
  if (!collectDoc?.items || !Array.isArray(collectDoc.items)) return "";
  const row = collectDoc.items.find(
    (it) => it?.topic_id === topicId && it?.source_platform === platform,
  );
  if (!row) return "";
  const title = typeof row.title === "string" ? row.title : "";
  const snippet = typeof row.snippet === "string" ? row.snippet : "";
  const text = [title, snippet].filter(Boolean).join(" — ");
  return text.slice(0, 800);
}

function validateResearch(research) {
  if (!research || typeof research !== "object") throw new Error("Missing research object");
  for (const key of RESEARCH_KEYS) {
    const arr = research[key];
    if (!Array.isArray(arr) || arr.length < 3) {
      throw new Error(`research.${key} must be array with >= 3 strings`);
    }
    for (const s of arr) {
      if (typeof s !== "string" || !s.trim()) throw new Error(`research.${key} has empty entry`);
    }
  }
  return research;
}

function invokeContentResearch(agentId, payload) {
  const message = JSON.stringify(payload, null, 2);
  const raw = execFileSync(
    "openclaw",
    ["agent", "--agent", agentId, "--message", message, "--json"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 600_000 },
  );

  let outer;
  try {
    outer = JSON.parse(raw);
  } catch {
    return validateResearch(JSON.parse(extractJsonText(raw)).research);
  }

  const text =
    outer?.result?.payloads?.[0]?.text ??
    outer?.payloads?.[0]?.text ??
    outer?.text ??
    outer?.message ??
    raw;

  const parsed = JSON.parse(extractJsonText(String(text)));
  if (parsed.research) return validateResearch(parsed.research);
  return validateResearch(parsed);
}

function jstNow() {
  const d = new Date();
  const utc = d.getTime() + 9 * 60 * 60 * 1000;
  const j = new Date(utc);
  const pad = (n) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}T${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}:${pad(j.getUTCSeconds())}+09:00`;
}

function yyyymmddJst() {
  const d = new Date();
  const utc = d.getTime() + 9 * 60 * 60 * 1000;
  const j = new Date(utc);
  const pad = (n) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}${pad(j.getUTCMonth() + 1)}${pad(j.getUTCDate())}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node tools/content-research/run.mjs --task-id <task_id> [--force]
  node tools/content-research/run.mjs --selected-topics <path> [--force]

Reads Step4 selected_topics.v1 (+ optional selected_collect_items hints).
Writes approve/topic_research_<date>_<runId>.json (memo.md / schema topic_research.v1).
Does not change orchestrator or submit-pick.`);
    process.exit(0);
  }

  const selectedPath = resolveSelectedTopicsPath(args.taskId, args.selectedTopics);
  const selectedDoc = readJson(selectedPath);
  const taskId = selectedDoc.task_id ?? args.taskId;
  const runId = selectedDoc.run_id ?? "r01";

  const approveDir = path.dirname(selectedPath);
  const outName = `topic_research_${yyyymmddJst()}_${runId}.json`;
  const outPath = path.join(approveDir, outName);

  if (fs.existsSync(outPath) && !args.force) {
    const taskPatch = patchTaskResearchRefSkipped(taskId, outPath);
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          outputPath: outPath,
          research_ref: outPath,
          taskPatch,
        },
        null,
        2,
      ),
    );
    return;
  }

  const collectPath = findCollectItemsPath(taskId, selectedDoc);
  const collectDoc = collectPath && fs.existsSync(collectPath) ? readJson(collectPath) : null;

  const items = Array.isArray(selectedDoc.items) ? selectedDoc.items : [];
  if (!items.length) throw new Error("selected_topics.items is empty");

  const outItems = [];
  for (const row of items) {
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const topic_id = typeof row.topic_id === "string" ? row.topic_id : "";
    const source_platform = typeof row.source_platform === "string" ? row.source_platform : "";
    if (!title || !topic_id) throw new Error("selected_topics item missing title or topic_id");

    const payload = {
      task: "generate_research_brief",
      title,
      topic_id,
      source_platform,
      task_id: taskId,
      run_id: runId,
    };
    if (typeof row.source_url === "string" && row.source_url.trim()) {
      payload.source_url = row.source_url.trim();
    }
    const hint = collectHintForTopic(collectDoc, topic_id, source_platform);
    if (hint) payload.collect_hint = hint;

    console.error(`[content-research] ${title.slice(0, 60)}…`);
    const research = invokeContentResearch(args.agentId, payload);

    const outRow = {
      topic_id,
      title,
      source_platform,
      research,
    };
    if (typeof row.index === "number") outRow.index = row.index;
    if (row.source_url) outRow.source_url = row.source_url;
    outItems.push(outRow);
  }

  const artifact = {
    schema_version: "topic_research.v1",
    generated_at: jstNow(),
    task_id: taskId,
    run_id: runId,
    selected_by: selectedDoc.selected_by ?? "content-research-tool",
    selected_at: selectedDoc.selected_at ?? jstNow(),
    source_candidates_ref: selectedDoc.source_candidates_ref ?? "",
    source_selected_topics_ref: selectedPath,
    selected_indices: selectedDoc.selected_indices ?? [],
    items: outItems,
  };

  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2), "utf8");

  const patchScript = path.join(__dirname, "patchTaskResearchRef.ts");
  const nodeDir = path.join(PUBLISH_ROOT, "node");
  let taskPatch = null;
  try {
    const patchOut = execFileSync(
      "npx",
      ["tsx", patchScript, "--task-id", taskId, "--research-ref", outPath],
      { encoding: "utf8", cwd: nodeDir, maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
    );
    taskPatch = JSON.parse(patchOut.trim());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`topic_research written but task.json patch failed: ${msg}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath: outPath,
        itemCount: outItems.length,
        input: selectedPath,
        research_ref: outPath,
        taskPatch,
      },
      null,
      2,
    ),
  );
}

function patchTaskResearchRefSkipped(taskId, researchRefPath) {
  if (!taskId || !researchRefPath) return null;
  const patchScript = path.join(__dirname, "patchTaskResearchRef.ts");
  const nodeDir = path.join(PUBLISH_ROOT, "node");
  try {
    const patchOut = execFileSync(
      "npx",
      ["tsx", patchScript, "--task-id", taskId, "--research-ref", researchRefPath],
      { encoding: "utf8", cwd: nodeDir, maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
    );
    return JSON.parse(patchOut.trim());
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
