import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTaskDetail } from "../api/hooks/useTaskDetail";
import { StepDetailDrawer } from "../components/task/StepDetailDrawer";
import { StepDetailTabs } from "../components/task/StepDetailTabs";
import { StepProgressBar } from "../components/task/StepProgressBar";
import { TaskStatusBadge } from "../components/task/TaskStatusBadge";
import type { StepDto, UiStepDto } from "../types/task";
import { formatJst } from "../utils/formatJst";
import { stepStatusLabel } from "../utils/stepStatusColor";

const STEP_ROWS: Array<{ key: keyof TaskSummarySteps; label: string }> = [
  { key: "collect", label: "采集" },
  { key: "tidy", label: "整理" },
  { key: "approval", label: "选题 (approval)" },
  { key: "approve", label: "选题 (approve)" },
  { key: "research", label: "调研" },
  { key: "copy", label: "文案" },
  { key: "image", label: "配图" },
  { key: "publish", label: "发布" },
];

type TaskSummarySteps = {
  collect?: StepDto;
  tidy?: StepDto;
  approval?: StepDto;
  approve?: StepDto;
  research?: StepDto;
  copy?: StepDto;
  image?: StepDto;
  publish?: StepDto;
};

function StepRow({ label, step }: { label: string; step?: StepDto }) {
  if (!step) {
    return (
      <tr className="border-t border-slate-100">
        <td className="py-2 pr-4 text-slate-700">{label}</td>
        <td className="py-2 text-slate-400">—</td>
        <td className="py-2 text-slate-400">—</td>
        <td className="py-2 text-slate-400">—</td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="py-2 pr-4 text-slate-700">{label}</td>
      <td className="py-2">{stepStatusLabel(step.status)}</td>
      <td className="py-2 font-mono text-xs text-slate-600">{formatJst(step.started_at)}</td>
      <td className="py-2 font-mono text-xs text-slate-600">{formatJst(step.finished_at)}</td>
    </tr>
  );
}

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const taskQuery = useTaskDetail(taskId);
  const [drawerStep, setDrawerStep] = useState<UiStepDto | null>(null);

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-blue-600 hover:underline">
        ← 返回总览
      </Link>

      {taskQuery.isLoading && <p className="text-slate-600">加载中…</p>}

      {taskQuery.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {taskQuery.error instanceof Error ? taskQuery.error.message : "加载失败"}
        </div>
      )}

      {taskQuery.isSuccess && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-mono text-2xl font-semibold">{taskQuery.data.task_id}</h1>
              <p className="mt-1 text-sm text-slate-500">
                run {taskQuery.data.run_id} · revision {taskQuery.data.revision}
              </p>
            </div>
            <TaskStatusBadge status={taskQuery.data.status} />
          </div>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">流程进度</h2>
            <p className="mb-3 text-xs text-slate-500">点击步骤圆圈查看该步详情</p>
            <StepProgressBar steps={taskQuery.data.ui_steps} onStepClick={setDrawerStep} />
          </section>

          {taskId && <StepDetailTabs taskId={taskId} />}

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">步骤明细</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-2 pr-4 font-medium">步骤</th>
                    <th className="pb-2 font-medium">状态</th>
                    <th className="pb-2 font-medium">开始</th>
                    <th className="pb-2 font-medium">结束</th>
                  </tr>
                </thead>
                <tbody>
                  {STEP_ROWS.map((row) => (
                    <StepRow key={row.key} label={row.label} step={taskQuery.data.steps[row.key]} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">元数据</h2>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">created_at</dt>
                <dd className="font-mono">{formatJst(taskQuery.data.created_at)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">updated_at</dt>
                <dd className="font-mono">{formatJst(taskQuery.data.updated_at)}</dd>
              </div>
              {taskQuery.data.orchestrator_meta?.last_event_id && (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">last_event_id</dt>
                  <dd className="break-all font-mono text-xs">{taskQuery.data.orchestrator_meta.last_event_id}</dd>
                </div>
              )}
            </dl>
          </section>

          <StepDetailDrawer
            open={drawerStep !== null}
            task={taskQuery.data}
            uiStep={drawerStep}
            onClose={() => setDrawerStep(null)}
          />
        </>
      )}
    </div>
  );
}
