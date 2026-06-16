import type { CopyDraftRow } from "../../utils/copyDrafts";
import { draftBody, groupDraftsByPlatform } from "../../utils/copyDrafts";

type Props = {
  drafts: CopyDraftRow[];
};

export function CopyByPlatform({ drafts }: Props) {
  const grouped = groupDraftsByPlatform(drafts);
  if (!grouped.size) return null;

  return (
    <div className="space-y-4">
      {[...grouped.entries()].map(([platform, items]) => (
        <section key={platform}>
          <h4 className="border-b border-slate-200 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-800">
            {platform}
          </h4>
          <ul className="mt-2 space-y-3">
            {items.map((draft, i) => {
              const body = draftBody(draft);
              return (
                <li key={`${platform}-${i}`} className="rounded border border-slate-200 bg-white p-3">
                  {draft.title && <p className="text-sm font-medium text-slate-900">{draft.title}</p>}
                  {draft.locale && <p className="mt-0.5 text-xs text-slate-500">{draft.locale}</p>}
                  {draft.topic_title && items.length > 1 && (
                    <p className="mt-1 text-xs text-slate-500">话题：{draft.topic_title}</p>
                  )}
                  {body ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{body}</p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">（无正文）</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
