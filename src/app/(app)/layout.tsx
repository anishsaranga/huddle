import { TabBar } from "@/components/TabBar";
import { requireOnboardedUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Authoritative gate for every app page (the proxy only checks the cookie).
  await requireOnboardedUser();

  return (
    <div className="flex h-dvh flex-col">
      <main
        className="scroll-area flex-1 overflow-x-hidden"
        style={{
          paddingBottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 24px)",
        }}
      >
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>
      <TabBar />
    </div>
  );
}
