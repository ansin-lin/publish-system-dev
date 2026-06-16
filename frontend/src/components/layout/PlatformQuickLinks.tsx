const PLATFORM_LINKS = [
  { id: "facebook", label: "Facebook", href: "https://www.facebook.com/" },
  { id: "xiaohongshu", label: "小红书", href: "https://creator.xiaohongshu.com/new/home" },
  { id: "x", label: "X", href: "https://x.com/home" },
  { id: "instagram", label: "Instagram", href: "https://www.instagram.com/" },
  { id: "youtube", label: "YouTube", href: "https://studio.youtube.com/" },
  { id: "tiktok", label: "TikTok", href: "https://www.tiktok.com/tiktokstudio/upload" },
] as const;

export function PlatformQuickLinks() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="text-slate-500">平台：</span>
      {PLATFORM_LINKS.map((item) => (
        <a
          key={item.id}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-900 hover:underline"
        >
          {item.label}
        </a>
      ))}
    </div>
  );
}
