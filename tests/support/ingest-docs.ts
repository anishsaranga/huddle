import { METRIC_FIELDS, type MetricFieldDef } from "@/lib/health/fields";

const num = (n: number) => n.toLocaleString("en-US");

/** The metric table in docs/ingest-api.md, generated from src/lib/health/fields.ts. */
export function renderMetricTable(): string {
  const lines = [
    "| Key | What | Unit | Type | Valid range | Notes |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const f of METRIC_FIELDS as readonly MetricFieldDef[]) {
    const notes = [
      f.type === "int" ? "rounded to a whole number" : "",
      f.fraction ? "a 0-1 fraction is multiplied by 100" : "",
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(`| \`${f.name}\` | ${f.label} | ${f.unit} | ${f.type} | ${num(f.min)} to ${num(f.max)} | ${notes} |`);
  }
  return lines.join("\n");
}
