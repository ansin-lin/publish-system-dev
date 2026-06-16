/**
 * Classify Facebook post URLs returned after publish.
 * Query params like notif_t=onthisday often appear on real /posts/pfbid… permalinks.
 */

export type FacebookUrlClass = "ok" | "missing" | "onthisday_page" | "unlikely";

export function classifyFacebookPostUrl(raw: string | null | undefined): {
  class: FacebookUrlClass;
  pathname: string;
  note?: string;
} {
  const url = raw?.trim();
  if (!url) return { class: "missing", pathname: "" };

  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = url.split("?")[0]?.toLowerCase() ?? "";
  }

  if (pathname.includes("/onthisday")) {
    return { class: "onthisday_page", pathname, note: "path_is_onthisday" };
  }

  if (pathname.includes("/posts/pfbid") || /\/posts\/pfbid/i.test(pathname)) {
    return { class: "ok", pathname, note: "pfbid_permalink" };
  }
  if (/\/posts\/\d+/i.test(pathname)) {
    return { class: "ok", pathname, note: "numeric_post" };
  }
  if (pathname.includes("permalink.php")) {
    return { class: "ok", pathname, note: "permalink_php" };
  }

  const lower = url.toLowerCase();
  if (lower.includes("pfbid")) {
    return { class: "ok", pathname, note: "pfbid_in_url" };
  }

  return { class: "unlikely", pathname, note: "unrecognized_post_path" };
}

export function facebookUrlFailsValidation(
  url: string | null | undefined,
  mode: "strict" | "balanced" | "loose",
): string | null {
  const c = classifyFacebookPostUrl(url);
  if (c.class === "missing") return "post_url missing";
  if (mode === "loose") return null;
  if (c.class === "ok") return null;
  if (mode === "balanced") {
    if (c.class === "onthisday_page") return "path is onthisday, not a new post";
    if (c.class === "unlikely") return `unrecognized post path (${c.pathname || "empty"})`;
    return null;
  }
  // strict (legacy): reject notif/onthisday anywhere in full URL
  const lower = (url ?? "").toLowerCase();
  if (lower.includes("onthisday") || lower.includes("notif_t=onthisday")) {
    return "query/path contains onthisday (strict)";
  }
  if (c.class === "unlikely") return c.note ?? "invalid facebook url";
  return null;
}
