import type { ArtifactSummaryDto } from "../../types/artifact";
import type { CopyDraftRow } from "../../utils/copyDrafts";
import { CopyByPlatform } from "./CopyByPlatform";
import { PublishResultList } from "./PublishResultList";
import type { PublishPlatformRow } from "../../utils/publishDisplay";

type Props = {
  artifact: ArtifactSummaryDto;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

export function ArtifactPreview({ artifact }: Props) {
  const { summary, schema_version, artifact_path, artifact_paths, file_urls } = artifact;

  if (summary.error === "no_artifact") {
    return <p className="text-sm text-slate-500">该步骤暂无产物文件。</p>;
  }

  return (
    <div className="space-y-4 text-sm">
      {schema_version && (
        <p className="text-slate-500">
          schema: <code className="rounded bg-slate-100 px-1">{schema_version}</code>
        </p>
      )}
      {artifact_path && (
        <p className="break-all font-mono text-xs text-slate-500">{artifact_path}</p>
      )}
      {artifact_paths && artifact_paths.length > 1 && (
        <ul className="list-inside list-disc text-xs text-slate-500">
          {artifact_paths.map((p) => (
            <li key={p} className="break-all font-mono">
              {p}
            </li>
          ))}
        </ul>
      )}

      {artifact.step === "collect" && (
        <CollectSummary summary={summary} />
      )}
      {artifact.step === "tidy" && <TidySummary summary={summary} />}
      {artifact.step === "approve" && <ApproveSummary summary={summary} />}
      {artifact.step === "generate" && (
        <GenerateSummary summary={summary} file_urls={file_urls} />
      )}
      {artifact.step === "publish" && <PublishSummary summary={summary} />}
    </div>
  );
}

function CollectSummary({ summary }: { summary: Record<string, unknown> }) {
  const samples = Array.isArray(summary.sample_titles) ? summary.sample_titles : [];
  return (
    <div>
      <p>
        采集条目：<strong>{String(summary.item_count ?? 0)}</strong> · ok: {String(summary.ok)}
        {summary.truncated === true && <span className="text-slate-500">（仅显示前 500 条）</span>}
      </p>
      <ul className="mt-2 max-h-[28rem] space-y-1 overflow-y-auto">
        {samples.map((s, i) => {
          const row = isRecord(s) ? s : {};
          const url = typeof row.url === "string" ? row.url : "";
          return (
            <li key={i} className="text-slate-700">
              [{String(row.platform ?? "")}] {String(row.title ?? "")}
              {url && (
                <a href={url} target="_blank" rel="noreferrer" className="ml-1 text-xs text-blue-600 hover:underline">
                  链接
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TidySummary({ summary }: { summary: Record<string, unknown> }) {
  const topics = Array.isArray(summary.topics) ? summary.topics : [];
  return (
    <div>
      <p>
        候选话题：<strong>{String(summary.candidate_count ?? topics.length)}</strong>
        {summary.truncated === true && <span className="text-slate-500">（仅显示前 500 条）</span>}
      </p>
      <ol className="mt-2 max-h-[28rem] list-decimal space-y-1 overflow-y-auto pl-5">
        {topics.map((t, i) => {
          const row = isRecord(t) ? t : {};
          return (
            <li key={i}>
              <span className="font-medium">{String(row.title ?? "")}</span>
              <span className="text-slate-500"> · {String(row.platform ?? "")}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ApproveSummary({ summary }: { summary: Record<string, unknown> }) {
  const artifacts = Array.isArray(summary.artifacts) ? summary.artifacts : [];
  return (
    <div className="space-y-4">
      {artifacts.map((a, i) => {
        const row = isRecord(a) ? a : {};
        if (row.kind === "selected_topics") {
          const topics = Array.isArray(row.topics) ? row.topics : [];
          return (
            <div key={i}>
              <p className="font-medium">已选话题 ({String(row.selected_count ?? topics.length)})</p>
              <ul className="mt-1 list-disc pl-5">
                {topics.map((t, j) => {
                  const tr = isRecord(t) ? t : {};
                  return <li key={j}>{String(tr.title ?? "")}</li>;
                })}
              </ul>
            </div>
          );
        }
        if (row.kind === "topic_research") {
          const items = Array.isArray(row.items) ? row.items : [];
          return (
            <div key={i}>
              <p className="font-medium">调研摘要 ({String(row.item_count ?? items.length)})</p>
              <ul className="mt-1 space-y-2">
                {items.map((it, j) => {
                  const ir = isRecord(it) ? it : {};
                  const points = Array.isArray(ir.core_points) ? ir.core_points : [];
                  return (
                    <li key={j}>
                      <span className="font-medium">{String(ir.title ?? "")}</span>
                      {points.length > 0 && (
                        <ul className="mt-0.5 list-disc pl-5 text-slate-600">
                          {points.map((p, k) => (
                            <li key={k}>{String(p)}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        }
        return (
          <p key={i} className="text-slate-500">
            {String(row.kind ?? "artifact")}
          </p>
        );
      })}
    </div>
  );
}

function GenerateSummary({
  summary,
  file_urls,
}: {
  summary: Record<string, unknown>;
  file_urls?: Array<{ path: string; url: string }>;
}) {
  const copy = isRecord(summary.copy) ? summary.copy : null;
  const image = isRecord(summary.image) ? summary.image : null;
  const drafts: CopyDraftRow[] =
    copy && Array.isArray(copy.drafts) ? copy.drafts.filter((d): d is CopyDraftRow => isRecord(d)) : [];
  const images = image && Array.isArray(image.images) ? image.images : [];

  return (
    <div className="space-y-4">
      {copy && (
        <div>
          <p className="mb-3 font-medium">文案 ({String(copy.topic_count ?? 0)} topics)</p>
          <CopyByPlatform drafts={drafts} />
        </div>
      )}
      {image && (
        <div>
          <p className="font-medium">
            配图 ({String(image.image_count ?? 0)}) · {String(image.image_source ?? "")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((img, i) => {
              const row = isRecord(img) ? img : {};
              const url = typeof row.url === "string" ? row.url : "";
              if (!url) return null;
              return (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
                  <img src={url} alt={String(row.slot ?? i)} className="h-24 w-auto rounded border object-cover" />
                </a>
              );
            })}
          </div>
          {file_urls && file_urls.length > images.length && (
            <p className="mt-1 text-xs text-slate-500">+{file_urls.length - images.length} 个文件</p>
          )}
        </div>
      )}
    </div>
  );
}

function PublishSummary({ summary }: { summary: Record<string, unknown> }) {
  const platforms: PublishPlatformRow[] = Array.isArray(summary.platforms)
    ? summary.platforms.filter((p): p is PublishPlatformRow => isRecord(p))
    : [];
  return (
    <div>
      {typeof summary.summary_text === "string" && summary.summary_text && (
        <p className="mb-2 text-slate-700">{summary.summary_text}</p>
      )}
      <PublishResultList platforms={platforms} />
    </div>
  );
}
