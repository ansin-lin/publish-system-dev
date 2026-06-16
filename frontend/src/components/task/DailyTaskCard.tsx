import { useState } from "react";
import { Link } from "react-router-dom";
import type { TaskSummaryDto, UiStepDto } from "../../types/task";
import { formatJst } from "../../utils/formatJst";
import { isStepClickable } from "../../utils/stepStatusColor";
import { HumanGateAlert } from "./HumanGateAlert";
import { StepProgressBar } from "./StepProgressBar";
import { StepResultPanel } from "./StepResultPanel";
import { TaskStatusBadge } from "./TaskStatusBadge";

type Props = {
  task: TaskSummaryDto;
};

export function DailyTaskCard({ task }: Props) {
  const [expandedStep, setExpandedStep] = useState<UiStepDto | null>(null);

  const handleStepClick = (step: UiStepDto) => {
    if (!isStepClickable(step.status)) return;
    setExpandedStep((prev) => (prev?.key === step.key ? null : step));
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-lg font-semibold text-slate-900">{task.task_id}</h2>
          <p className="mt-1 text-sm text-slate-500">
            run {task.run_id} · 更新于 {formatJst(task.updated_at)}
            {task.degraded ? " · 降级模式" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <span className="text-sm text-slate-500">{task.progress.percent}%</span>
        </div>
      </div>

      <HumanGateAlert task={task} />

      {(task.status === "awaiting_publish_review" || task.status === "revising_copy") && (
        <Link
          to={`/task/${encodeURIComponent(task.task_id)}`}
          className="inline-flex rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800"
        >
          打开发布前确认（勾选平台 / 确认发布）
        </Link>
      )}

      <p className="text-xs text-slate-500">点击已完成的步骤圆圈查看结果（灰色/蓝色步骤不可点）</p>
      <StepProgressBar
        steps={task.ui_steps}
        onStepClick={handleStepClick}
        selectedStepKey={expandedStep?.key ?? null}
      />

      {expandedStep && (
        <StepResultPanel task={task} uiStep={expandedStep} onClose={() => setExpandedStep(null)} />
      )}

      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <p className="text-sm text-slate-600">
          当前阶段：<span className="font-medium text-slate-800">{task.progress.label}</span>
        </p>
        <Link
          to={`/task/${encodeURIComponent(task.task_id)}`}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          完整详情 →
        </Link>
      </div>
    </section>
  );
}
