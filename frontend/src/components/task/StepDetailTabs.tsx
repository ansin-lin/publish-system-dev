import { useState } from "react";
import { useArtifact } from "../../api/hooks/useArtifact";
import type { ArtifactStep } from "../../types/artifact";
import { ArtifactPreview } from "./ArtifactPreview";

const TABS: Array<{ step: ArtifactStep; label: string }> = [
  { step: "collect", label: "采集" },
  { step: "tidy", label: "整理" },
  { step: "approve", label: "选题/调研" },
  { step: "generate", label: "生成" },
  { step: "publish", label: "发布" },
];

type Props = {
  taskId: string;
};

export function StepDetailTabs({ taskId }: Props) {
  const [active, setActive] = useState<ArtifactStep>("tidy");
  const artifact = useArtifact(taskId, active);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">产物预览</h2>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.step}
            type="button"
            onClick={() => setActive(tab.step)}
            className={`rounded px-3 py-1.5 text-sm ${
              active === tab.step
                ? "bg-blue-100 font-medium text-blue-800"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {artifact.isLoading && <p className="text-sm text-slate-600">加载产物…</p>}
        {artifact.isError && (
          <p className="text-sm text-red-700">
            {artifact.error instanceof Error ? artifact.error.message : "加载失败"}
          </p>
        )}
        {artifact.isSuccess && <ArtifactPreview artifact={artifact.data} />}
      </div>
    </section>
  );
}
