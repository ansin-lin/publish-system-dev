import { formatPublishResultLine, isPublishSuccess, type PublishPlatformRow } from "../../utils/publishDisplay";

type Props = {
  platforms: PublishPlatformRow[];
};

export function PublishResultList({ platforms }: Props) {
  if (!platforms.length) return null;

  return (
    <ul className="space-y-1.5 text-sm text-slate-700">
      {platforms.map((row, i) => {
        const line = formatPublishResultLine(row);
        const success = isPublishSuccess(row.status);
        return (
          <li key={`${row.platform ?? i}-${i}`}>
            <span className={success ? "text-emerald-800" : row.status === "auth_expired" || row.status === "failed" ? "text-red-800" : ""}>
              {line}
            </span>
            {success && row.url && (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-xs text-blue-600 hover:underline"
              >
                查看链接
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
