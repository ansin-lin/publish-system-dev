export type PublishPlatformRow = {
  platform?: string;
  status?: string;
  reason?: string | null;
  error?: string | null;
  url?: string;
};

function failureDetail(reason: string | null | undefined, status: string): string | null {
  if (!reason?.trim()) {
    if (status === "auth_expired") return "登录态失效";
    return null;
  }
  const r = reason.trim();
  if (r.includes("登录态失效")) return "登录态失效";
  if (r.includes("未检测到已登录") || r.includes("Cookie")) return "未登录";
  if (r.length > 40) return `${r.slice(0, 40)}…`;
  return r;
}

export function formatPublishResultLine(row: PublishPlatformRow): string {
  const platform = row.platform?.trim() || "unknown";
  const status = row.status?.trim() || "";
  const reason = row.reason ?? row.error ?? null;

  if (status === "published" || status === "success") {
    return `${platform}：成功`;
  }
  if (status === "auth_expired") {
    return `${platform}：失败（登录态失效）`;
  }
  if (status === "failed" || status === "error") {
    const detail = failureDetail(reason, status);
    return detail ? `${platform}：失败（${detail}）` : `${platform}：失败`;
  }
  if (status === "skipped") {
    return `${platform}：跳过`;
  }
  if (status === "pending" || status === "running") {
    return `${platform}：进行中`;
  }

  const detail = failureDetail(reason, status);
  if (detail) return `${platform}：${status || "未知"}（${detail}）`;
  if (status) return `${platform}：${status}`;
  return `${platform}：未知`;
}

export function isPublishSuccess(status: string | undefined): boolean {
  return status === "published" || status === "success";
}
