import { db } from "@/db";
import { getCoverage, getIngestOverview, getSleepSources, getUnknownFields, LOOKBACK_DAYS } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/session";
import { SectionHeader } from "../../_components/SectionHeader";
import { CoverageGrid } from "../_components/CoverageGrid";
import { IngestLogLinks, SleepSources, UnknownFields } from "../_components/Panels";
import { DataSection } from "../_components/UserBits";

export const metadata = { title: "Data · Admin" };

export default async function DataPage() {
  await requireAdmin();
  const now = new Date();
  const [coverage, unknown, sources, overview] = await Promise.all([
    getCoverage(db, { now }),
    getUnknownFields(db, { now }),
    getSleepSources(db, { now }),
    getIngestOverview(db),
  ]);

  return (
    <>
      <SectionHeader kicker="Admin" title="Data coverage">
        What each person&rsquo;s devices and Shortcut actually send. Tap a cell for the detail, a name for their ingest log.
      </SectionHeader>

      <CoverageGrid coverage={coverage} />

      <DataSection
        id="unknown-fields"
        title="Unknown fields"
        blurb={`Keys Huddle doesn’t use yet, seen in the last ${LOOKBACK_DAYS} days.`}
      >
        <UnknownFields rows={unknown} days={LOOKBACK_DAYS} />
      </DataSection>

      <DataSection
        id="sleep-sources"
        title="Sleep sources"
        blurb="Which app or device wrote each person's sleep, and the stages it provides."
      >
        <SleepSources rows={sources} />
      </DataSection>

      <DataSection id="ingest-logs" title="Ingest logs" blurb="Every authenticated sync request, newest first.">
        <IngestLogLinks rows={overview} />
      </DataSection>
    </>
  );
}
