import type { TaskSummaryDto, UiStepDto } from "../../types/task";
import { drawerTitle } from "../../utils/stepDrawer";
import { StepResultList } from "./StepResultList";

type Props = {
  task: TaskSummaryDto;
  uiStep: UiStepDto;
  onClose: () => void;
};

function CollapseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200 hover:text-slate-800"
    >
      收起
    </button>
  );
}

export function StepResultPanel({ task, uiStep, onClose }: Props) {
  return (
    <div className="mt-4 flex max-h-96 flex-col rounded-lg border border-slate-200 bg-slate-50">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-900">{drawerTitle(uiStep)}</h3>
        <CollapseButton onClose={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <StepResultList key={uiStep.key} task={task} uiStep={uiStep} />
      </div>
      <div className="flex shrink-0 justify-center border-t border-slate-200 px-4 py-2">
        <CollapseButton onClose={onClose} />
      </div>
    </div>
  );
}
