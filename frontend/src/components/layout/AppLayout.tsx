import { Link, Outlet } from "react-router-dom";
import { PlatformQuickLinks } from "./PlatformQuickLinks";

export function AppLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl space-y-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-lg font-semibold text-slate-900">
              发布流水线仪表盘
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link to="/" className="text-slate-600 hover:text-slate-900">
                总览
              </Link>
              <Link to="/system" className="text-slate-600 hover:text-slate-900">
                运维
              </Link>
            </nav>
          </div>
          <PlatformQuickLinks />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
