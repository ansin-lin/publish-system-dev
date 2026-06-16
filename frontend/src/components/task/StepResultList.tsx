import { useState, type ReactNode } from "react";
import { useArtifact } from "../../api/hooks/useArtifact";
import type { ArtifactStep } from "../../types/artifact";
import type { TaskSummaryDto, UiStepDto } from "../../types/task";
import { formatJst } from "../../utils/formatJst";
import { ListPagination } from "../common/ListPagination";
import { CopyByPlatform } from "./CopyByPlatform";
import { PublishResultList } from "./PublishResultList";
import type { PublishPlatformRow } from "../../utils/publishDisplay";
import type { CopyDraftRow } from "../../utils/copyDrafts";

type Props = {
  task: TaskSummaryDto;
  uiStep: UiStepDto;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function LoadingOrError({ loading, error }: { loading: boolean; error: unknown }) {
  if (loading) return <p className="text-sm text-slate-500">加载中…</p>;
  if (error) {
    return <p className="text-sm text-red-700">{error instanceof Error ? error.message : "加载失败"}</p>;
  }
  return null;
}

function NoArtifact() {
  return <p className="text-sm text-slate-500">该步骤暂无结果。</p>;
}

function CreateStepResult({ task }: { task: TaskSummaryDto }) {
  return (
    <ul className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="text-slate-500">状态</span>
        <span>成功</span>
      </li>
      <li className="flex gap-2">
        <span className="text-slate-500">创建时间</span>
        <span className="font-mono">{formatJst(task.created_at)}</span>
      </li>
    </ul>
  );
}

function PaginatedArtifactList({
  taskId,
  step,
  section,
  render,
}: {
  taskId: string;
  step: ArtifactStep;
  section?: "selected" | "research" | "copy" | "image";
  render: (summary: Record<string, unknown>) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  const artifact = useArtifact(taskId, step, { page, section });

  const pending = <LoadingOrError loading={artifact.isLoading} error={artifact.isError ? artifact.error : null} />;
  if (artifact.isLoading || artifact.isError) return pending;
  if (!artifact.isSuccess) return null;
  if (artifact.data.summary.error === "no_artifact") return <NoArtifact />;

  return (
    <>
      {render(artifact.data.summary)}
      <ListPagination pagination={artifact.data.pagination} page={page} onPageChange={setPage} />
    </>
  );
}

function CollectList({ summary }: { summary: Record<string, unknown> }) {
  const samples = Array.isArray(summary.sample_titles) ? summary.sample_titles : [];
  if (!samples.length) return <NoArtifact />;
  return (
    <ul className="space-y-1 text-sm">
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
  );
}

function TidyList({ summary }: { summary: Record<string, unknown> }) {
  const topics = Array.isArray(summary.topics) ? summary.topics : [];
  if (!topics.length) return <NoArtifact />;
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm">
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
  );
}

function SelectedTopicsList({ summary }: { summary: Record<string, unknown> }) {
  const artifacts = Array.isArray(summary.artifacts) ? summary.artifacts : [];
  const block = artifacts.find((a) => isRecord(a) && a.kind === "selected_topics");
  const topics = block && isRecord(block) && Array.isArray(block.topics) ? block.topics : [];
  if (!topics.length) return <NoArtifact />;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {topics.map((t, i) => {
        const row = isRecord(t) ? t : {};
        return <li key={i}>{String(row.title ?? "")}</li>;
      })}
    </ul>
  );
}

function ResearchList({ summary }: { summary: Record<string, unknown> }) {
  const artifacts = Array.isArray(summary.artifacts) ? summary.artifacts : [];
  const block = artifacts.find((a) => isRecord(a) && a.kind === "topic_research");
  const items = block && isRecord(block) && Array.isArray(block.items) ? block.items : [];
  if (!items.length) return <NoArtifact />;
  return (
    <ul className="space-y-2 text-sm">
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
  );
}

function parseCopyDrafts(summary: Record<string, unknown>): CopyDraftRow[] {
  const copy = isRecord(summary.copy) ? summary.copy : null;
  if (!copy || !Array.isArray(copy.drafts)) return [];
  return copy.drafts.filter((d): d is CopyDraftRow => isRecord(d));
}

function ImageThumbList({ summary }: { summary: Record<string, unknown> }) {
  const image = isRecord(summary.image) ? summary.image : null;
  const images = image && Array.isArray(image.images) ? image.images : [];
  if (!images.length) return <NoArtifact />;

  return (
    <ul className="flex flex-wrap gap-2">
      {images.map((img, i) => {
        const row = isRecord(img) ? img : {};
        const url = typeof row.url === "string" ? row.url : "";
        if (!url) return null;
        return (
          <li key={i}>
            <a href={url} target="_blank" rel="noreferrer" className="block">
              <img
                src={url}
                alt={String(row.slot ?? i)}
                className="h-24 w-auto max-w-full rounded border border-slate-200 object-cover"
                loading="lazy"
              />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function PublishList({ summary }: { summary: Record<string, unknown> }) {
  const platforms: PublishPlatformRow[] = Array.isArray(summary.platforms)
    ? summary.platforms.filter((p): p is PublishPlatformRow => isRecord(p))
    : [];
  if (!platforms.length) return <NoArtifact />;
  return <PublishResultList platforms={platforms} />;
}

function Step4Results({ taskId }: { taskId: string }) {
  const [candidatesPage, setCandidatesPage] = useState(0);
  const [selectedPage, setSelectedPage] = useState(0);
  const tidy = useArtifact(taskId, "tidy", { page: candidatesPage });
  const selected = useArtifact(taskId, "approve", { page: selectedPage, section: "selected" });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">已选话题</h3>
        <LoadingOrError loading={selected.isLoading} error={selected.isError ? selected.error : null} />
        {selected.isSuccess &&
          (selected.data.summary.error === "no_artifact" ? (
            <NoArtifact />
          ) : (
            <>
              <SelectedTopicsList summary={selected.data.summary} />
              <ListPagination pagination={selected.data.pagination} page={selectedPage} onPageChange={setSelectedPage} />
            </>
          ))}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">候选话题</h3>
        <LoadingOrError loading={tidy.isLoading} error={tidy.isError ? tidy.error : null} />
        {tidy.isSuccess &&
          (tidy.data.summary.error === "no_artifact" ? (
            <NoArtifact />
          ) : (
            <>
              <TidyList summary={tidy.data.summary} />
              <ListPagination pagination={tidy.data.pagination} page={candidatesPage} onPageChange={setCandidatesPage} />
            </>
          ))}
      </div>
    </div>
  );
}

function Step6Results({ taskId }: { taskId: string }) {
  const [copyPage, setCopyPage] = useState(0);
  const [imagePage, setImagePage] = useState(0);
  const copy = useArtifact(taskId, "generate", { page: copyPage, section: "copy" });
  const image = useArtifact(taskId, "generate", { page: imagePage, section: "image" });

  const copyDrafts =
    copy.isSuccess && isRecord(copy.data.summary.copy) && Array.isArray(copy.data.summary.copy.drafts)
      ? copy.data.summary.copy.drafts
      : [];
  const imageThumbs =
    image.isSuccess && isRecord(image.data.summary.image) && Array.isArray(image.data.summary.image.images)
      ? image.data.summary.image.images
      : [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">文案</h3>
        <LoadingOrError loading={copy.isLoading} error={copy.isError ? copy.error : null} />
        {copy.isSuccess &&
          (copy.data.summary.error === "no_artifact" || !copyDrafts.length ? (
            <NoArtifact />
          ) : (
            <>
              <CopyByPlatform drafts={copyDrafts} />
              <ListPagination pagination={copy.data.pagination} page={copyPage} onPageChange={setCopyPage} />
            </>
          ))}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">配图</h3>
        <LoadingOrError loading={image.isLoading} error={image.isError ? image.error : null} />
        {image.isSuccess &&
          (image.data.summary.error === "no_artifact" || !imageThumbs.length ? (
            <NoArtifact />
          ) : (
            <>
              <ImageThumbList summary={image.data.summary} />
              <ListPagination pagination={image.data.pagination} page={imagePage} onPageChange={setImagePage} />
            </>
          ))}
      </div>
    </div>
  );
}

export function StepResultList({ task, uiStep }: Props) {
  const taskId = task.task_id;

  if (uiStep.index === 1) {
    return <CreateStepResult task={task} />;
  }

  if (uiStep.index === 4) {
    return <Step4Results taskId={taskId} />;
  }

  if (uiStep.index === 6) {
    return <Step6Results taskId={taskId} />;
  }

  if (uiStep.index === 2) {
    return (
      <PaginatedArtifactList taskId={taskId} step="collect" render={(summary) => <CollectList summary={summary} />} />
    );
  }

  if (uiStep.index === 3) {
    return <PaginatedArtifactList taskId={taskId} step="tidy" render={(summary) => <TidyList summary={summary} />} />;
  }

  if (uiStep.index === 5) {
    return (
      <PaginatedArtifactList
        taskId={taskId}
        step="approve"
        section="research"
        render={(summary) => <ResearchList summary={summary} />}
      />
    );
  }

  if (uiStep.index === 7) {
    return (
      <PaginatedArtifactList taskId={taskId} step="publish" render={(summary) => <PublishList summary={summary} />} />
    );
  }

  return null;
}
