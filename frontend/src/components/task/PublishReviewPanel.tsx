import { useEffect, useMemo, useRef, useState } from "react";
import type { PublishReviewDraftRow } from "../../api/client";
import {
  useApprovePublishReview,
  usePublishReview,
  useRegenerateCopy,
} from "../../api/hooks/usePublishReview";

type Props = {
  taskId: string;
  taskStatus: string;
};

function draftPreview(draft: PublishReviewDraftRow): string {
  const head = draft.title ? `${draft.title}\n\n` : "";
  return `${head}${draft.body}`.trim();
}

export function PublishReviewPanel({ taskId, taskStatus }: Props) {
  const reviewQuery = usePublishReview(taskId, taskStatus);
  const approveMutation = useApprovePublishReview(taskId);
  const regenMutation = useRegenerateCopy(taskId);

  const platforms = useMemo(() => {
    const drafts = reviewQuery.data?.drafts ?? [];
    return [...new Set(drafts.map((d) => d.platform))];
  }, [reviewQuery.data?.drafts]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const prevStatusRef = useRef(taskStatus);

  useEffect(() => {
    if (prevStatusRef.current === "revising_copy" && taskStatus === "awaiting_publish_review") {
      setFeedback("");
      setSelected(new Set());
    }
    prevStatusRef.current = taskStatus;
  }, [taskStatus]);

  const regeneratedPlatforms = useMemo(
    () => new Set((reviewQuery.data?.last_regenerated_platforms ?? []).map((p) => p.toLowerCase())),
    [reviewQuery.data?.last_regenerated_platforms],
  );

  if (taskStatus !== "awaiting_publish_review" && taskStatus !== "revising_copy") {
    return null;
  }

  if (reviewQuery.isLoading) {
    return (
      <section className="rounded-lg border border-violet-200 bg-violet-50 p-5 shadow-sm">
        <p className="text-sm text-violet-900">加载发布前确认…</p>
      </section>
    );
  }

  if (reviewQuery.isError || !reviewQuery.data) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-5 shadow-sm">
        <p className="text-sm text-red-800">
          {reviewQuery.error instanceof Error ? reviewQuery.error.message : "加载失败"}
        </p>
      </section>
    );
  }

  const ctx = reviewQuery.data;
  const revisionsLeft = Math.max(0, ctx.max_revisions - ctx.revision_count);
  const busy = approveMutation.isPending || regenMutation.isPending || taskStatus === "revising_copy";

  const togglePlatform = (platform: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const toggleExpanded = (platform: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const handleRegenerate = () => {
    const platformsToRegen = [...selected];
    if (!platformsToRegen.length) return;
    if (!feedback.trim()) return;
    regenMutation.mutate(
      { platforms: platformsToRegen, feedback: feedback.trim() },
      {
        onSuccess: (data) => {
          setFeedback("");
          setSelected(new Set());
          setExpanded((prev) => new Set([...prev, ...data.merged_platforms]));
        },
      },
    );
  };

  return (
    <section id="publish-review-panel" className="rounded-lg border border-violet-300 bg-violet-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-violet-950">发布前确认</h2>
          <p className="mt-1 text-sm text-violet-800">
            {taskStatus === "revising_copy" ?
              "正在重生选中平台文案…"
            : `等待确认 · 还可修改 ${revisionsLeft} 次（约束校验失败不计入）`}
            {ctx.image_count > 0 && ` · 配图 ${ctx.image_count} 张（重生文案不会改图）`}
          </p>
        </div>
        {ctx.copy_review_status === "failed" && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">上次重生失败</span>
        )}
        {ctx.last_error && ctx.last_error_kind === "constraint" && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">约束校验未通过</span>
        )}
      </div>

      {ctx.last_error && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {ctx.last_error_kind === "constraint" ?
            "上次重生因字数/平台约束未通过，未占用修改次数。请调整说明后重试。"
          : "上次重生失败："}
          {ctx.last_error_kind !== "constraint" && (
            <span className="mt-1 block font-mono text-xs text-amber-900">{ctx.last_error}</span>
          )}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {platforms.map((platform) => {
          const draft = ctx.drafts.find((d) => d.platform === platform);
          if (!draft) return null;
          const isOpen = expanded.has(platform);
          const preview = draftPreview(draft);
          const short = preview.length > 180 ? `${preview.slice(0, 180)}…` : preview;
          const isRegenerated = regeneratedPlatforms.has(platform.toLowerCase());

          return (
            <li
              key={platform}
              className={
                isRegenerated ?
                  "rounded border border-emerald-300 bg-emerald-50/60 p-3"
                : "rounded border border-violet-200 bg-white p-3"
              }
            >
              <div className="flex flex-wrap items-start gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={selected.has(platform)}
                    disabled={busy || !ctx.can_regenerate}
                    onChange={() => togglePlatform(platform)}
                  />
                  <span className="uppercase tracking-wide">{platform}</span>
                  {draft.locale && <span className="font-normal text-slate-500">({draft.locale})</span>}
                  {isRegenerated && (
                    <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      已重生
                    </span>
                  )}
                </label>
                <button
                  type="button"
                  className="ml-auto text-xs text-violet-700 hover:underline"
                  onClick={() => toggleExpanded(platform)}
                >
                  {isOpen ? "收起" : "展开预览"}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {isOpen ? preview : short}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="mt-4">
        <label className="block text-sm font-medium text-violet-950" htmlFor="publish-review-feedback">
          修改说明（勾选平台重生时必填）
        </label>
        <textarea
          id="publish-review-feedback"
          rows={3}
          className="mt-1 w-full rounded border border-violet-200 bg-white px-3 py-2 text-sm text-slate-800"
          placeholder="例如：Facebook 语气更口语；小红书标题更吸引点击"
          value={feedback}
          disabled={busy}
          onChange={(e) => setFeedback(e.target.value)}
        />
        {!ctx.can_regenerate && ctx.regenerate_blocked_reason && (
          <p className="mt-1 text-xs text-amber-800">{ctx.regenerate_blocked_reason}</p>
        )}
      </div>

      {(approveMutation.error || regenMutation.error) && (
        <p className="mt-3 text-sm text-red-700">
          {(approveMutation.error ?? regenMutation.error) instanceof Error ?
            (approveMutation.error ?? regenMutation.error)!.message
          : "操作失败"}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || selected.size === 0 || !feedback.trim() || !ctx.can_regenerate}
          className="rounded bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleRegenerate}
        >
          {regenMutation.isPending || taskStatus === "revising_copy" ? "重生中…" : "重生选中平台文案"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => approveMutation.mutate("approve")}
        >
          {approveMutation.isPending ? "提交中…" : "确认并发布"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            if (window.confirm("确定驳回并取消本任务发布？")) {
              approveMutation.mutate("reject");
            }
          }}
        >
          取消
        </button>
      </div>
    </section>
  );
}
