import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderMetricTable } from "../support/ingest-docs";

describe("docs/ingest-api.md", () => {
  it("has the metric table generated from src/lib/health/fields.ts", () => {
    const doc = readFileSync("docs/ingest-api.md", "utf8").replace(/\r\n/g, "\n");
    const m = /<!-- metric-table:start -->\n([\s\S]*?)\n<!-- metric-table:end -->/.exec(doc);
    expect(m, "metric-table markers missing").not.toBeNull();
    // On failure, paste the expected table (below) between the markers.
    expect(m![1]).toBe(renderMetricTable());
  });
});
