/** Full-bleed, single-screen shell for /login and /denied. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-safe pb-safe px-safe relative isolate flex min-h-dvh flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6">{children}</div>
    </div>
  );
}
