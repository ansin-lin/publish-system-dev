export type SlackApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type SlackMessage = {
  type?: string;
  user?: string;
  text?: string;
  ts?: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
};

async function slackApiGet<T extends Record<string, unknown>>(
  method: string,
  token: string,
  query: Record<string, string>,
): Promise<SlackApiResult<T>> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!data.ok) {
    return { ok: false, error: data.error ?? `http_${res.status}` };
  }
  return { ok: true, data };
}

async function slackApi<T extends Record<string, unknown>>(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SlackApiResult<T>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!data.ok) {
    return { ok: false, error: data.error ?? `http_${res.status}` };
  }
  return { ok: true, data };
}

export async function slackChatPostMessage(params: {
  token: string;
  channel: string;
  text: string;
  thread_ts?: string;
}): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const body: Record<string, unknown> = {
    channel: params.channel,
    text: params.text,
    mrkdwn: true,
  };
  if (params.thread_ts) body.thread_ts = params.thread_ts;
  const result = await slackApi<{ ts?: string }>("chat.postMessage", params.token, body);
  if (!result.ok) return { ok: false, error: result.error };
  const ts = result.data.ts;
  if (typeof ts !== "string" || !ts) return { ok: false, error: "missing_ts" };
  return { ok: true, ts };
}

export type SlackThreadMessage = {
  ts: string;
  user: string;
  text: string;
  isBot: boolean;
};

export async function slackConversationsReplies(params: {
  token: string;
  channel: string;
  ts: string;
  limit?: number;
}): Promise<SlackApiResult<{ messages: SlackThreadMessage[] }>> {
  const result = await slackApiGet<{ messages?: SlackMessage[] }>("conversations.replies", params.token, {
    channel: params.channel,
    ts: params.ts,
    limit: String(params.limit ?? 100),
  });
  if (!result.ok) return result;
  const raw = result.data.messages ?? [];
  const messages: SlackThreadMessage[] = [];
  for (const m of raw) {
    if (typeof m.ts !== "string" || !m.ts) continue;
    const text = typeof m.text === "string" ? m.text.trim() : "";
    if (!text) continue;
    messages.push({
      ts: m.ts,
      user: typeof m.user === "string" ? m.user : "",
      text,
      isBot: isSlackBotMessage(m),
    });
  }
  return { ok: true, data: { messages } };
}

export function isSlackBotMessage(m: SlackMessage): boolean {
  if (m.bot_id) return true;
  if (m.subtype === "bot_message") return true;
  if (m.subtype === "channel_join" || m.subtype === "channel_leave") return true;
  return false;
}

export function slackTsGreater(a: string, b: string): boolean {
  const [asRaw, amRaw] = a.split(".");
  const [bsRaw, bmRaw] = b.split(".");
  const as = Number(asRaw);
  const bs = Number(bsRaw);
  const am = Number(amRaw ?? 0);
  const bm = Number(bmRaw ?? 0);
  if (!Number.isFinite(as) || !Number.isFinite(bs)) return a > b;
  if (as !== bs) return as > bs;
  return am > bm;
}
