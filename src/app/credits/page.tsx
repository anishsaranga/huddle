import type { Metadata } from "next";
import { ConfigAvatar } from "@/components/avatar/ConfigAvatar";
import { Badge } from "@/components/ui/Badge";
import { randomConfig, seededRng } from "@/lib/avatar/config";
import { STYLE_LIST } from "@/lib/avatar/styles";

export const metadata: Metadata = { title: "Credits" };

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-text-2 underline decoration-hairline-strong underline-offset-[3px] transition-colors active:text-text"
    >
      {children}
    </a>
  );
}

/**
 * Avatar artwork credits. Each DiceBear style keeps its designer's license
 * (from DiceBear's license table and each package's LICENSE file); the
 * CC BY 4.0 ones require this attribution. Public so it can be linked from
 * anywhere (Profile links here).
 */
export default function CreditsPage() {
  return (
    <main className="pt-safe pb-safe px-safe mx-auto min-h-app max-w-md">
      <header className="px-5 pb-6 pt-10">
        <p className="telemetry mb-2">Huddle · licenses</p>
        <h1 className="font-display text-[44px] font-bold uppercase leading-[0.9] tracking-[0.02em]">Credits</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">
          Avatars are drawn on your device and our server with{" "}
          <ExtLink href="https://www.dicebear.com">DiceBear</ExtLink> (code under the MIT license). The artwork
          belongs to the designers below and is used under their licenses.
        </p>
      </header>

      <ul className="space-y-3 px-4 pb-16">
        {STYLE_LIST.map((s) => (
          <li key={s.id} className="surface p-5">
            <div className="relative flex items-start gap-4">
              <ConfigAvatar config={randomConfig(s.id, seededRng(`credits:${s.id}`))} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-[24px] font-bold uppercase leading-none tracking-[0.02em]">
                    {s.name}
                  </h2>
                  <Badge tone={s.requiresAttribution ? "admin" : "neutral"}>
                    {s.license.name.startsWith("CC") ? s.license.name : "Free use"}
                  </Badge>
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{s.attribution}</p>
                <dl className="telemetry mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                  <dt>Design</dt>
                  <dd className="normal-case tracking-normal">
                    <ExtLink href={s.source.url}>{s.source.title}</ExtLink>
                  </dd>
                  <dt>Designer</dt>
                  <dd className="normal-case tracking-normal">
                    <ExtLink href={s.creator.url}>{s.creator.name}</ExtLink>
                  </dd>
                  <dt>License</dt>
                  <dd className="normal-case tracking-normal">
                    <ExtLink href={s.license.url}>{s.license.name}</ExtLink>
                  </dd>
                </dl>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="telemetry px-5 pb-10 text-dim">
        Full license table: <ExtLink href="https://www.dicebear.com/licenses/">dicebear.com/licenses</ExtLink>
      </p>
    </main>
  );
}
