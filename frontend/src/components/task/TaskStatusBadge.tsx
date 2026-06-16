import { taskStatusBadgeClass } from "../../utils/stepStatusColor";

type Props = {
  status: string;
};

export function TaskStatusBadge({ status }: Props) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${taskStatusBadgeClass(status)}`}>
      {status}
    </span>
  );
}
