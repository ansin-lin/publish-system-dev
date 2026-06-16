import { slackConversationsReplies, slackTsGreater, type SlackThreadMessage } from "./slackClient.js";

export type SlackReplyRow = SlackThreadMessage;

const PICK_LINE_RE = /^pick\s+[\d,\s]+$/i;
const TITLE_LINE_RE = /^title\s+[\s\S]+$/i;

export function isPickCommandText(text: string): boolean {
  return PICK_LINE_RE.test(text.trim());
}

export function isSelectionCommandText(text: string): boolean {
  const t = text.trim();
  return PICK_LINE_RE.test(t) || TITLE_LINE_RE.test(t);
}

/** Fetch thread replies; includes parent at [0] when present. */
export async function fetchThreadReplies(params: {
  token: string;
  channel: string;
  threadTs: string;
}): Promise<{ ok: true; messages: SlackReplyRow[] } | { ok: false; error: string }> {
  const result = await slackConversationsReplies({
    token: params.token,
    channel: params.channel,
    ts: params.threadTs,
    limit: 200,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, messages: result.data.messages };
}

/** Human messages newer than cursor, excluding root post, oldest first. */
export function selectNewHumanPickCandidates(params: {
  messages: SlackReplyRow[];
  threadTs: string;
  lastPolledTs: string | undefined;
  rootMessageTs: string | undefined;
}): SlackReplyRow[] {
  const cursor =
    params.lastPolledTs?.trim() ||
    params.rootMessageTs?.trim() ||
    params.threadTs.trim();
  const out: SlackReplyRow[] = [];
  for (const m of params.messages) {
    if (m.ts === params.threadTs) continue;
    if (params.rootMessageTs && m.ts === params.rootMessageTs) continue;
    if (!slackTsGreater(m.ts, cursor)) continue;
    if (m.isBot) continue;
    if (!m.user) continue;
    out.push(m);
  }
  out.sort((a, b) => (slackTsGreater(b.ts, a.ts) ? 1 : slackTsGreater(a.ts, b.ts) ? -1 : 0));
  return out;
}

export function maxSlackTs(a: string, b: string): string {
  return slackTsGreater(a, b) ? a : b;
}
