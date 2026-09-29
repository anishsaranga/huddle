import { TabBar } from "@/components/TabBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <main
        className="scroll-area flex-1"
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
