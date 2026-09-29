import { describe, expect, it } from "vitest";
import { describeAttemptError, formatIssuePath, summarizeIngestErrors } from "@/lib/sync/attempt";

describe("formatIssuePath", () => {
  it("joins keys with dots and indexes in brackets", () => {
    expect(formatIssuePath(["series", "steps", "values", 3])).toBe("series.steps.values[3]");
    expect(formatIssuePath([0, "steps"])).toBe("[0].steps");
    expect(formatIssuePath([])).toBe("");
  });
});

describe("summarizeIngestErrors", () => {
  it("uses the first validation issue, with its path", () => {
    expect(
      summarizeIngestErrors({
        reason: "validation",
        issues: [
          { path: ["window", "from"], message: "window.from (2026-09-30) is after window.to (2026-09-29)" },
          { path: ["x"], message: "second" },
        ],
      }),
    ).toBe("window.from: window.from (2026-09-30) is after window.to (2026-09-29)");
  });

  it("never echoes payload strings, but keeps quoted metric names", () => {
    expect(
      summarizeIngestErrors({ issues: [{ path: ["series", "steps", "values", 0], message: 'expected a number, got "lots"' }] }),
    ).toBe('series.steps.values[0]: expected a number, got "…"');
    expect(
      summarizeIngestErrors({
        issues: [{ path: ["series", "steps"], message: 'series "steps": starts and values need the same number of lines (starts: 3, values: 2)' }],
      }),
    ).toBe('series.steps: series "steps": starts and values need the same number of lines (starts: 3, values: 2)');
    // The schema cuts long values without a closing quote.
    expect(
      summarizeIngestErrors({ issues: [{ path: ["hr", "starts", 2], message: 'expected a timestamp, got "28. September 2026 um 00:0...' }] }),
    ).toBe('hr.starts[2]: expected a timestamp, got "…"');
    expect(
      summarizeIngestErrors({ issues: [{ path: [], message: 'unparseable timestamp "gk_secret \\"quoted\\" text"' }] }),
    ).toBe('unparseable timestamp "…"');
  });

  it("falls back to the error code", () => {
    expect(summarizeIngestErrors({ reason: "invalid_json", detail: "Unexpected token } in JSON at position 12: {\"a\":}" })).toBe(
      "invalid_json",
    );
    expect(summarizeIngestErrors({ reason: "key_rate_limited" })).toBe("key_rate_limited");
  });

  it("trims and caps the length", () => {
    const long = summarizeIngestErrors({ issues: [{ path: ["series"], message: `  lots   of\n space ${"x".repeat(300)}` }] })!;
    expect(long.startsWith("series: lots of space x")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("is undefined without errors", () => {
    expect(summarizeIngestErrors(null)).toBeUndefined();
    expect(summarizeIngestErrors({})).toBeUndefined();
    expect(summarizeIngestErrors({ issues: [] })).toBeUndefined();
  });
});

describe("describeAttemptError", () => {
  it("explains common statuses", () => {
    expect(describeAttemptError({ status: 400 })).toMatch(/rejected/);
    expect(describeAttemptError({ status: 400, error: "invalid_json" })).toMatch(/JSON/);
    expect(describeAttemptError({ status: 413 })).toMatch(/3 MB/);
    expect(describeAttemptError({ status: 429 })).toMatch(/Too many/);
    expect(describeAttemptError({ status: 500 })).toMatch(/problem/);
    expect(describeAttemptError({ status: 418 })).toMatch(/HTTP 418/);
  });
});
