import type { UiStepDto } from "../../types/task";
import { isStepClickable, stepStatusDotClass, stepStatusLabel, stepStatusTextClass } from "../../utils/stepStatusColor";

type Props = {
  steps: UiStepDto[];
  onStepClick?: (step: UiStepDto) => void;
  selectedStepKey?: string | null;
};

export function StepProgressBar({ steps, onStepClick, selectedStepKey }: Props) {
  return (
    <ol className="grid gap-3 sm:grid-cols-7">
      {steps.map((step) => {
        const clickable = Boolean(onStepClick) && isStepClickable(step.status);
        const selected = selectedStepKey === step.key;
        const dotClass = `${stepStatusDotClass(step.status)} ${
          clickable
            ? `cursor-pointer ring-2 ${selected ? "ring-blue-500" : "ring-transparent hover:ring-blue-300"} focus:ring-blue-400 focus:outline-none`
            : "cursor-default"
        }`;

        const inner = (
          <>
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white transition-transform ${dotClass} ${
                clickable ? "hover:scale-110" : ""
              }`}
              title={clickable ? `查看${step.label}结果` : stepStatusLabel(step.status)}
            >
              {step.index}
            </span>
            <span className="mt-2 text-sm font-medium text-slate-800">{step.label}</span>
            <span className={`mt-0.5 text-xs ${stepStatusTextClass(step.status)}`}>
              {stepStatusLabel(step.status)}
            </span>
          </>
        );

        return (
          <li key={step.key} className="flex flex-col items-center text-center">
            <div className="flex w-full items-center justify-center">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick!(step)}
                  className="flex flex-col items-center border-0 bg-transparent p-0"
                >
                  {inner}
                </button>
              ) : (
                <div className="flex flex-col items-center">{inner}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
