import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "./_components/AdminNav";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Non-admins get a 404 (the admin area isn't advertised). Pages and actions
  // re-check, since layouts don't re-run on client navigation.
  await requireAdmin();

  return (
    <div className="pb-safe px-safe mx-auto min-h-dvh w-full max-w-xl">
      <div className="nav-chrome pt-safe sticky top-0 z-40 border-b border-hairline bg-[rgba(10,11,13,0.9)] backdrop-blur-xl backdrop-saturate-150">
        <div className="flex items-center justify-between px-4 pt-2">
          <Link
            href="/profile"
            className="telemetry -ml-2 flex h-11 items-center gap-1 px-2 text-text-2 active:opacity-60"
          >
            <svg
              aria-hidden
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m10 3.5-4.5 4.5L10 12.5" />
            </svg>
            Profile
          </Link>
          <span className="telemetry" style={{ color: "var(--strain)" }}>
            Admin
          </span>
        </div>
        <div className="px-4 pb-3 pt-1">
          <AdminNav />
        </div>
      </div>
      <main className="px-4 pb-16 pt-6">{children}</main>
    </div>
  );
}
