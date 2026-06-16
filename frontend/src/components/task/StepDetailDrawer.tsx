import { useEffect } from "react";
import { useArtifact } from "../../api/hooks/useArtifact";
import type { TaskSummaryDto, UiStepDto } from "../../types/task";
import { formatJst } from "../../utils/formatJst";
import { stepStatusLabel } from "../../utils/stepStatusColor";
import { drawerTitle, getDrawerMode } from "../../utils/stepDrawer";
import { ArtifactPreview } from "./ArtifactPreview";
import { HumanGateAlert } from "./HumanGateAlert";

type Props = {
  open: boolean;
  task: TaskSummaryDto | null;
  uiStep: UiStepDto | null;
  onClose: () => void;
};

function CreateMetaContent({ task, uiStep }: { task: TaskSummaryDto; uiStep: UiStepDto }) {
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid gap-2">
        <div>
          <dt className="text-slate-500">task_id</dt>
          <dd className="font-mono">{task.task_id}</dd>
        </div>
        <div>
          <dt className="text-slate-500">run_id</dt>
          <dd>{task.run_id}</dd>
        </div>
        <div>
          <dt className="text-slate-500">状态</dt>
          <dd>{task.status}</dd>
        </div>
        <div>
          <dt className="text-slate-500">步骤状态</dt>
          <dd>{stepStatusLabel(uiStep.status)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">创建时间</dt>
          <dd className="font-mono">{formatJst(task.created_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">revision</dt>
          <dd>{task.revision}</dd>
        </div>
      </dl>
      {task.degraded && <p className="text-amber-700">当前处于降级模式</p>}
    </div>
  );
}

function Step4Content({ taskId }: { taskId: string }) {
  const tidy = useArtifact(taskId, "tidy");
  const approve = useArtifact(taskId, "approve");

  return (
    <div className="space-y-6">
      {approve.isSuccess &&
        approve.data.summary.error !== "no_artifact" && (
          <div>
            <h3 className="mb-2 font-medium text-slate-800">已选话题</h3>
            <ArtifactPreview artifact={approve.data} />
          </div>
        )}
      <div>
        <h3 className="mb-2 font-medium text-slate-800">候选话题列表</h3>
        {tidy.isLoading && <p className="text-sm text-slate-500">加载中…</p>}
        {tidy.isError && <p className="text-sm text-red-700">加载失败</p>}
        {tidy.isSuccess && <ArtifactPreview artifact={tidy.data} />}
      </div>
    </div>
  );
}

function ArtifactContent({ taskId, step }: { taskId: string; step: import("../../types/artifact").ArtifactStep }) {
  const artifact = useArtifact(taskId, step);

  if (artifact.isLoading) return <p className="text-sm text-slate-500">加载产物…</p>;
  if (artifact.isError) {
    return <p className="text-sm text-red-700">{artifact.error instanceof Error ? artifact.error.message : "加载失败"}</p>;
  }
  if (!artifact.isSuccess) return null;
  return <ArtifactPreview artifact={artifact.data} />;
}

export function StepDetailDrawer({ open, task, uiStep, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !task || !uiStep) return null;

  const mode = getDrawerMode(uiStep, task);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="关闭"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{drawerTitle(uiStep)}</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{task.task_id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="关闭抽屉"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <HumanGateAlert task={task} />
          <div className="mt-4">
            {mode.kind === "meta" && <CreateMetaContent task={task} uiStep={uiStep} />}
            {mode.kind === "artifact" && <ArtifactContent taskId={task.task_id} step={mode.step} />}
            {mode.kind === "step4" && <Step4Content taskId={task.task_id} />}
          </div>
        </div>
      </aside>
    </div>
  );
}
