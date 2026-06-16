import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../../../node/src/step2-collect/types.js";
import { loadOrchestratorSettings } from "../../../node/src/orchestrator/config.js";
import { loadTaskJson, taskJsonPath } from "../../../node/src/orchestrator/taskStore.js";
import type { OrchestratorSettings } from "../../../node/src/orchestrator/types.js";
import type { ArtifactPaginationDto, ArtifactStep, ArtifactSummaryDto } from "../types/artifact.js";
import { resolveUnderBase, taskDir } from "../utils/pathGuard.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonFile(filePath: string): JsonObject | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    return isObject(raw) ? raw : null;
  } catch {
    return null;
  }
}

function resolveArtifactPath(tasksRoot: string, taskId: string, ref: string | undefined): string | null {
  if (!ref?.trim()) return null;
  const trimmed = ref.trim();
  if (path.isAbsolute(trimmed)) {
    const base = taskDir(tasksRoot, taskId);
    const rel = path.relative(base, path.resolve(trimmed));
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return path.resolve(trimmed);
  }
  return resolveUnderBase(taskDir(tasksRoot, taskId), trimmed);
}

function relToTask(taskBase: string, absPath: string): string {
  return path.relative(taskBase, absPath).replace(/\\/g, "/");
}

function fileServeUrl(taskId: string, relPath: string): string {
  return `/api/tasks/${encodeURIComponent(taskId)}/files/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

export const ARTIFACT_PAGE_MAX = 60;
const ARTIFACT_LIST_CAP = 500;

export type ArtifactPageOptions = {
  limit: number;
  offset: number;
  section?: "selected" | "research" | "copy" | "image";
};

export type ArtifactQueryOptions = ArtifactPageOptions | undefined;

function normalizePageOptions(raw?: { limit?: number; offset?: number; section?: ArtifactPageOptions["section"] }): ArtifactPageOptions | undefined {
  if (raw?.limit === undefined && raw?.offset === undefined) return undefined;
  const limit = Math.min(Math.max(raw?.limit ?? ARTIFACT_PAGE_MAX, 1), ARTIFACT_PAGE_MAX);
  const offset = Math.max(raw?.offset ?? 0, 0);
  return { limit, offset, ...(raw?.section ? { section: raw.section } : {}) };
}

function paginate<T>(items: T[], page?: ArtifactPageOptions): { slice: T[]; pagination?: ArtifactPaginationDto } {
  if (!page) {
    return { slice: items.slice(0, ARTIFACT_LIST_CAP) };
  }
  return {
    slice: items.slice(page.offset, page.offset + page.limit),
    pagination: { total: items.length, limit: page.limit, offset: page.offset },
  };
}

function summarizeCollect(doc: JsonObject, page?: ArtifactPageOptions): { summary: Record<string, unknown>; pagination?: ArtifactPaginationDto } {
  const items = Array.isArray(doc.items) ? doc.items : [];
  const mapped = items.map((it) => {
    const row = isObject(it) ? it : {};
    return {
      title: typeof row.title === "string" ? row.title : "",
      platform: typeof row.source_platform === "string" ? row.source_platform : "",
      url: typeof row.source_url === "string" ? row.source_url : "",
    };
  });
  const { slice, pagination } = paginate(mapped, page);
  return {
    summary: {
      ok: doc.ok === true,
      item_count: items.length,
      ...(page ? {} : { truncated: items.length > ARTIFACT_LIST_CAP }),
      sample_titles: slice,
    },
    ...(pagination ? { pagination } : {}),
  };
}

function summarizeTidy(doc: JsonObject, page?: ArtifactPageOptions): { summary: Record<string, unknown>; pagination?: ArtifactPaginationDto } {
  const items = Array.isArray(doc.items) ? doc.items : [];
  const mapped = items.map((it) => {
    const row = isObject(it) ? it : {};
    return {
      index: row.index,
      title: typeof row.title === "string" ? row.title : "",
      platform: typeof row.source_platform === "string" ? row.source_platform : "",
      url: typeof row.source_url === "string" ? row.source_url : "",
    };
  });
  const { slice, pagination } = paginate(mapped, page);
  return {
    summary: {
      candidate_count: items.length,
      ...(page ? {} : { truncated: items.length > ARTIFACT_LIST_CAP }),
      topics: slice,
    },
    ...(pagination ? { pagination } : {}),
  };
}

function summarizeApprove(
  docs: JsonObject[],
  page?: ArtifactPageOptions,
): { summary: Record<string, unknown>; pagination?: ArtifactPaginationDto } {
  const artifacts: Array<Record<string, unknown>> = [];
  let pagination: ArtifactPaginationDto | undefined;

  for (const doc of docs) {
    const schema = typeof doc.schema_version === "string" ? doc.schema_version : "unknown";
    if (schema.startsWith("selected_topics")) {
      if (page?.section === "research") continue;
      const items = Array.isArray(doc.items) ? doc.items : [];
      const mapped = items.map((it) => {
        const row = isObject(it) ? it : {};
        return {
          title: typeof row.title === "string" ? row.title : "",
          topic_id: typeof row.topic_id === "string" ? row.topic_id : "",
        };
      });
      const paged = paginate(mapped, page?.section === "selected" || page ? page : undefined);
      pagination = paged.pagination ?? pagination;
      artifacts.push({
        kind: "selected_topics",
        selected_count: items.length,
        topics: paged.slice,
      });
    } else if (schema.startsWith("topic_research")) {
      if (page?.section === "selected") continue;
      const items = Array.isArray(doc.items) ? doc.items : [];
      const mapped = items.map((it) => {
        const row = isObject(it) ? it : {};
        const research = isObject(row.research) ? row.research : {};
        return {
          index: row.index,
          title: typeof row.title === "string" ? row.title : "",
          core_points: Array.isArray(research.core_points) ? research.core_points : [],
        };
      });
      const paged = paginate(mapped, page?.section === "research" || page ? page : undefined);
      pagination = paged.pagination ?? pagination;
      artifacts.push({
        kind: "topic_research",
        item_count: items.length,
        items: page ? paged.slice : paged.slice.slice(0, 10).map((it) => ({
          ...it,
          core_points: Array.isArray(it.core_points) ? it.core_points.slice(0, 5) : [],
        })),
      });
    } else if (!page) {
      artifacts.push({ kind: schema, raw_keys: Object.keys(doc) });
    }
  }

  return { summary: { artifacts }, ...(pagination ? { pagination } : {}) };
}

type CopyDraftRow = {
  platform: string;
  title: string;
  body: string;
  locale?: string;
  topic_title?: string;
};

/** copy_result.v1 stores drafts under items[].drafts[]; older shapes may use top-level drafts[]. */
function extractCopyDrafts(doc: JsonObject): CopyDraftRow[] {
  const rows: CopyDraftRow[] = [];

  const pushDraft = (raw: JsonObject, topicTitle: string) => {
    const body = typeof raw.body === "string" ? raw.body : "";
    rows.push({
      platform: typeof raw.platform === "string" ? raw.platform : "",
      title: typeof raw.title === "string" ? raw.title : "",
      body,
      ...(typeof raw.locale === "string" ? { locale: raw.locale } : {}),
      ...(topicTitle ? { topic_title: topicTitle } : {}),
    });
  };

  if (Array.isArray(doc.items)) {
    for (const item of doc.items) {
      if (!isObject(item)) continue;
      const topicTitle = typeof item.title === "string" ? item.title : "";
      const nested = Array.isArray(item.drafts) ? item.drafts : [];
      for (const d of nested) {
        if (isObject(d)) pushDraft(d, topicTitle);
      }
    }
  }

  if (!rows.length && Array.isArray(doc.drafts)) {
    for (const d of doc.drafts) {
      if (isObject(d)) pushDraft(d, "");
    }
  }

  return rows;
}

function summarizeGenerate(
  docs: JsonObject[],
  taskId: string,
  taskBase: string,
  page?: ArtifactPageOptions,
): {
  summary: Record<string, unknown>;
  file_urls: Array<{ path: string; url: string }>;
  pagination?: ArtifactPaginationDto;
} {
  const summary: Record<string, unknown> = {};
  const file_urls: Array<{ path: string; url: string }> = [];
  let pagination: ArtifactPaginationDto | undefined;

  for (const doc of docs) {
    const schema = typeof doc.schema_version === "string" ? doc.schema_version : "";
    if (schema.startsWith("copy_result") && page?.section !== "image") {
      const mapped = extractCopyDrafts(doc);
      const paged = paginate(mapped, page?.section === "copy" || page ? page : undefined);
      pagination = paged.pagination ?? pagination;
      summary.copy = {
        topic_count: Array.isArray(doc.items) ? doc.items.length : 0,
        drafts: paged.slice.map((row) => ({
          platform: row.platform,
          title: row.title,
          body: row.body,
          body_preview: row.body.length > 200 ? `${row.body.slice(0, 200)}…` : row.body,
          ...(row.locale ? { locale: row.locale } : {}),
          ...(row.topic_title ? { topic_title: row.topic_title } : {}),
        })),
      };
    }
    if (schema.startsWith("image_result") && page?.section !== "copy") {
      const images = Array.isArray(doc.images) ? doc.images : [];
      const mapped: Array<Record<string, unknown>> = [];
      for (const img of images) {
        if (!isObject(img)) continue;
        const assetPath = typeof img.asset_path === "string" ? img.asset_path : "";
        if (!assetPath) continue;
        const abs = path.isAbsolute(assetPath) ? assetPath : resolveUnderBase(taskBase, assetPath) ?? null;
        if (!abs || !fs.existsSync(abs)) continue;
        const rel = relToTask(taskBase, abs);
        const url = fileServeUrl(taskId, rel);
        const slot = typeof img.slot_id === "string" ? img.slot_id : typeof img.slot === "string" ? img.slot : "";
        mapped.push({
          slot,
          status: img.status,
          mode: img.mode,
          url,
          rel,
        });
      }
      const cap = page?.section === "image" || page ? page : undefined;
      const paged = paginate(mapped, cap);
      pagination = paged.pagination ?? pagination;
      const thumbs: Array<Record<string, unknown>> = [];
      for (const img of page ? paged.slice : paged.slice.slice(0, 16)) {
        if (!isObject(img)) continue;
        const rel = typeof img.rel === "string" ? img.rel : "";
        const url = typeof img.url === "string" ? img.url : "";
        if (rel) file_urls.push({ path: rel, url });
        thumbs.push({ slot: img.slot, status: img.status, mode: img.mode, url });
      }
      summary.image = {
        image_source: doc.image_source ?? null,
        image_count: images.length,
        images: thumbs,
      };
    }
  }

  return { summary, file_urls, ...(pagination ? { pagination } : {}) };
}

function summarizePublish(
  doc: JsonObject,
  page?: ArtifactPageOptions,
): { summary: Record<string, unknown>; pagination?: ArtifactPaginationDto } {
  const results = Array.isArray(doc.platform_results) ? doc.platform_results : [];
  const mapped = results.map((r) => {
    const row = isObject(r) ? r : {};
    const reason =
      typeof row.reason === "string"
        ? row.reason
        : isObject(row.error) && typeof row.error.message === "string"
          ? row.error.message
          : null;
    return {
      platform: typeof row.platform === "string" ? row.platform : "",
      status: typeof row.status === "string" ? row.status : "",
      url:
        typeof row.post_url === "string"
          ? row.post_url
          : typeof row.post_id_or_url === "string"
            ? row.post_id_or_url
            : typeof row.url === "string"
              ? row.url
              : "",
      reason,
      error: reason,
    };
  });
  const { slice, pagination } = paginate(mapped, page);
  const summaryObj = isObject(doc.summary) ? doc.summary : null;
  return {
    summary: {
      summary_text:
        typeof doc.summary === "string"
          ? doc.summary
          : summaryObj && typeof summaryObj.status === "string"
            ? String(summaryObj.status)
            : null,
      platforms: slice,
    },
    ...(pagination ? { pagination } : {}),
  };
}

function findLatestJson(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();
  if (!files.length) return null;
  return path.join(dir, files[files.length - 1]!);
}

export function createArtifactService(settings: OrchestratorSettings = loadOrchestratorSettings()) {
  const tasksDir = settings.tasksDir;

  function resolveTaskFile(taskId: string, relPath: string): string | null {
    const base = taskDir(tasksDir, taskId);
    if (!fs.existsSync(base)) return null;
    return resolveUnderBase(base, relPath);
  }

  function getArtifact(taskId: string, step: ArtifactStep, query?: ArtifactQueryOptions): ArtifactSummaryDto | null {
    const page = normalizePageOptions(query);
    let task: JsonObject;
    try {
      task = loadTaskJson(taskJsonPath(settings, taskId)) as JsonObject;
    } catch {
      return null;
    }

    const base = taskDir(tasksDir, taskId);
    const steps = task.steps;
    const stepObj = isObject(steps) ? steps : {};

    if (step === "collect") {
      const ref = isObject(stepObj.collect) && typeof stepObj.collect.output_ref === "string"
        ? stepObj.collect.output_ref
        : findLatestJson(path.join(base, "collect"), "collect_result_");
      const abs = typeof ref === "string" ? resolveArtifactPath(tasksDir, taskId, ref) : null;
      if (!abs) return { step, schema_version: null, artifact_path: null, summary: { error: "no_artifact" } };
      const doc = readJsonFile(abs);
      if (!doc) return { step, schema_version: null, artifact_path: relToTask(base, abs), summary: { error: "parse_failed" } };
      const { summary, pagination } = summarizeCollect(doc, page);
      return {
        step,
        schema_version: typeof doc.schema_version === "string" ? doc.schema_version : null,
        artifact_path: relToTask(base, abs),
        summary,
        ...(pagination ? { pagination } : {}),
      };
    }

    if (step === "tidy") {
      const ref = isObject(stepObj.tidy) && typeof stepObj.tidy.output_ref === "string"
        ? stepObj.tidy.output_ref
        : findLatestJson(path.join(base, "tidy"), "topic_candidates_");
      const abs = typeof ref === "string" ? resolveArtifactPath(tasksDir, taskId, ref) : null;
      if (!abs) return { step, schema_version: null, artifact_path: null, summary: { error: "no_artifact" } };
      const doc = readJsonFile(abs);
      if (!doc) return { step, schema_version: null, artifact_path: relToTask(base, abs), summary: { error: "parse_failed" } };
      const { summary, pagination } = summarizeTidy(doc, page);
      return {
        step,
        schema_version: typeof doc.schema_version === "string" ? doc.schema_version : null,
        artifact_path: relToTask(base, abs),
        summary,
        ...(pagination ? { pagination } : {}),
      };
    }

    if (step === "approve") {
      const paths: string[] = [];
      const docs: JsonObject[] = [];
      const approveDir = path.join(base, "approve");
      const refs = [
        isObject(stepObj.approve) ? stepObj.approve.output_ref : undefined,
        isObject(stepObj.approve) ? (stepObj.approve as JsonObject).selected_topics_ref : undefined,
        isObject(stepObj.research) ? stepObj.research.output_ref : undefined,
        findLatestJson(approveDir, "selected_topics_"),
        findLatestJson(approveDir, "topic_research_"),
      ];
      for (const ref of refs) {
        if (typeof ref !== "string") continue;
        const abs = resolveArtifactPath(tasksDir, taskId, ref);
        if (!abs || paths.includes(abs)) continue;
        const doc = readJsonFile(abs);
        if (doc) {
          paths.push(abs);
          docs.push(doc);
        }
      }
      if (!docs.length) {
        return { step, schema_version: null, artifact_path: null, summary: { error: "no_artifact" } };
      }
      const { summary, pagination } = summarizeApprove(docs, page);
      return {
        step,
        schema_version: typeof docs[0]!.schema_version === "string" ? docs[0]!.schema_version : null,
        artifact_path: relToTask(base, paths[0]!),
        artifact_paths: paths.map((p) => relToTask(base, p)),
        summary,
        ...(pagination ? { pagination } : {}),
      };
    }

    if (step === "generate") {
      const paths: string[] = [];
      const docs: JsonObject[] = [];
      const genDir = path.join(base, "generate");
      const refs = [
        isObject(stepObj.copy) ? stepObj.copy.output_ref : undefined,
        isObject(stepObj.image) ? stepObj.image.output_ref : undefined,
        findLatestJson(genDir, "copy_result_"),
        findLatestJson(genDir, "image_result_"),
      ];
      for (const ref of refs) {
        if (typeof ref !== "string") continue;
        const abs = resolveArtifactPath(tasksDir, taskId, ref);
        if (!abs || paths.includes(abs)) continue;
        const doc = readJsonFile(abs);
        if (doc) {
          paths.push(abs);
          docs.push(doc);
        }
      }
      if (!docs.length) {
        return { step, schema_version: null, artifact_path: null, summary: { error: "no_artifact" } };
      }
      const { summary, file_urls, pagination } = summarizeGenerate(docs, taskId, base, page);
      return {
        step,
        schema_version: typeof docs[0]!.schema_version === "string" ? docs[0]!.schema_version : null,
        artifact_path: relToTask(base, paths[0]!),
        artifact_paths: paths.map((p) => relToTask(base, p)),
        summary,
        file_urls,
        ...(pagination ? { pagination } : {}),
      };
    }

    if (step === "publish") {
      const ref = isObject(stepObj.publish) && typeof stepObj.publish.output_ref === "string"
        ? stepObj.publish.output_ref
        : findLatestJson(path.join(base, "publish"), "publish_result_");
      const abs = typeof ref === "string" ? resolveArtifactPath(tasksDir, taskId, ref) : null;
      if (!abs) return { step, schema_version: null, artifact_path: null, summary: { error: "no_artifact" } };
      const doc = readJsonFile(abs);
      if (!doc) return { step, schema_version: null, artifact_path: relToTask(base, abs), summary: { error: "parse_failed" } };
      const { summary, pagination } = summarizePublish(doc, page);
      return {
        step,
        schema_version: typeof doc.schema_version === "string" ? doc.schema_version : null,
        artifact_path: relToTask(base, abs),
        summary,
        ...(pagination ? { pagination } : {}),
      };
    }

    return null;
  }

  return { getArtifact, resolveTaskFile, tasksDir };
}

export type ArtifactService = ReturnType<typeof createArtifactService>;
