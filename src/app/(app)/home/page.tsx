import { Dial } from "@/components/Dial";
import { PageHeader } from "@/components/PageHeader";

export const metadata = { title: "Home" };

export default function HomePage() {
  return (
    <>
      <PageHeader title="Overview" subtitle="Today" />
      <div className="space-y-3 px-5">
        <section className="rounded-2xl border border-hairline bg-card px-3 py-6">
          <div className="flex items-start justify-between">
            <Dial
              value={72}
              max={100}
              color="var(--recovery-green)"
              label="Recovery"
              display="72%"
              size={96}
              className="flex-1"
            />
            <Dial
              value={11.4}
              max={21}
              color="var(--strain)"
              label="Strain"
              display="11.4"
              size={96}
              className="flex-1"
            />
            <Dial
              value={84}
              max={100}
              color="var(--sleep)"
              label="Sleep"
              display="84%"
              size={96}
              className="flex-1"
            />
          </div>
        </section>
        <section className="rounded-2xl border border-hairline bg-card p-5">
          <p className="label mb-2">Key stats</p>
          <p className="text-[15px] leading-relaxed text-muted">
            Resting HR, sleep, steps and more, compared with your 30-day baseline, will live
            here.
          </p>
        </section>
      </div>
    </>
  );
}
