import type { ArtifactStep } from "../types/artifact";
import type { TaskSummaryDto, UiStepDto } from "../types/task";

export type StepDrawerMode =
  | { kind: "meta" }
  | { kind: "artifact"; step: ArtifactStep }
  | { kind: "step4" };

export function getDrawerMode(uiStep: UiStepDto, _task: TaskSummaryDto): StepDrawerMode {
  switch (uiStep.index) {
    case 1:
      return { kind: "meta" };
    case 2:
      return { kind: "artifact", step: "collect" };
    case 3:
      return { kind: "artifact", step: "tidy" };
    case 4:
      return { kind: "step4" };
    case 5:
      return { kind: "artifact", step: "approve" };
    case 6:
      return { kind: "artifact", step: "generate" };
    case 7:
      return { kind: "artifact", step: "publish" };
    default:
      return { kind: "meta" };
  }
}

export function drawerTitle(uiStep: UiStepDto): string {
  return `Step ${uiStep.index} · ${uiStep.label}`;
}
