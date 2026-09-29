import { describe, expect, it } from "vitest";
import {
  buildNights,
  groupSessions,
  normalizeStage,
  summarizeNight,
  unionMinutes,
  type Segment,
} from "@/lib/ingest/sleep-merge";
import type { SleepStage } from "@/lib/ingest/types";

const TZ = "Europe/Berlin";
const MIN = 60_000;

/** A segment from local wall-clock times with an explicit offset, e.g. ("core", "2026-09-27T23:00+02:00", ...). */
const seg = (stage: SleepStage, start: string, end: string, source: string): Segment => ({
  stage,
  start: Date.parse(start),
  end: Date.parse(end),
  source,
});

/** Sep 27 -> 28 2026 (CEST, +02:00). `t("23:00")` is on the 27th for hours >= 12, else the 28th. */
const t = (hm: string) => {
  const h = Number(hm.slice(0, 2));
  return `2026-09-${h >= 12 ? "27" : "28"}T${hm}:00+02:00`;
};
const s = (stage: SleepStage, from: string, to: string, source: string) => seg(stage, t(from), t(to), source);

const WATCH = "Apple Watch";
const IPHONE = "Anish’s iPhone";

const appleWatchNight: Segment[] = [
  s("in_bed", "22:45", "07:00", IPHONE),
  s("core", "23:00", "00:30", WATCH),
  s("deep", "00:30", "01:15", WATCH),
  s("core", "01:15", "02:00", WATCH),
  s("rem", "02:00", "02:40", WATCH),
  s("awake", "02:40", "02:50", WATCH),
  s("core", "02:50", "04:30", WATCH),
  s("deep", "04:30", "05:00", WATCH),
  s("rem", "05:00", "06:00", WATCH),
  s("core", "06:00", "06:45", WATCH),
  s("awake", "06:45", "06:55", WATCH),
];

// Fitbit writes "Light" (mapped to core by normalizeStage before this point).
const fitbitNight: Segment[] = [
  s("core", "23:30", "01:00", "Fitbit"),
  s("deep", "01:00", "02:00", "Fitbit"),
  s("rem", "02:00", "02:30", "Fitbit"),
  s("awake", "02:30", "02:45", "Fitbit"),
  s("core", "02:45", "05:00", "Fitbit"),
  s("rem", "05:00", "06:00", "Fitbit"),
  s("awake", "06:00", "06:10", "Fitbit"),
];

const zeppNight: Segment[] = [
  s("asleep", "23:00", "03:00", "Zepp Life"),
  s("awake", "03:00", "03:20", "Zepp Life"),
  s("asleep", "03:20", "07:00", "Zepp Life"),
];

describe("normalizeStage", () => {
  it.each([
    ["In Bed", "in_bed"],
    ["inbed", "in_bed"],
    ["INBED", "in_bed"],
    ["in_bed", "in_bed"],
    ["Asleep", "asleep"],
    ["Asleep Unspecified", "asleep"],
    ["Unspecified", "asleep"],
    ["Awake", "awake"],
    [" awake ", "awake"],
    ["Core", "core"],
    ["Light", "core"],
    ["Asleep (Core)", "core"],
    ["Deep", "deep"],
    ["REM", "rem"],
    ["rem", "rem"],
    [0, "in_bed"],
    [1, "asleep"],
    [2, "awake"],
    [3, "core"],
    [4, "deep"],
    [5, "rem"],
  ] as const)("%j -> %s", (raw, expected) => {
    expect(normalizeStage(raw)).toBe(expected);
  });

  it.each(["Nap", "", "Restless", "asleepish", 6, -1])("%j is unknown", (raw) => {
    expect(normalizeStage(raw)).toBeNull();
  });
});

describe("unionMinutes", () => {
  it("counts overlaps once", () => {
    expect(unionMinutes([])).toBe(0);
    expect(unionMinutes([[0, 60 * MIN]])).toBe(60);
    expect(unionMinutes([[0, 60 * MIN], [30 * MIN, 90 * MIN]])).toBe(90);
    expect(unionMinutes([[30 * MIN, 90 * MIN], [0, 60 * MIN], [100 * MIN, 110 * MIN]])).toBe(100);
    expect(unionMinutes([[0, 100 * MIN], [10 * MIN, 20 * MIN]])).toBe(100);
    // Touching intervals merge without a gap.
    expect(unionMinutes([[0, 10 * MIN], [10 * MIN, 20 * MIN]])).toBe(20);
  });
});

describe("groupSessions", () => {
  it("splits on a gap of 90 minutes or more, across sources", () => {
    const joined = groupSessions([s("asleep", "23:00", "02:00", "A"), s("asleep", "03:29", "07:00", "B")]);
    expect(joined).toHaveLength(1);
    const split = groupSessions([s("asleep", "23:00", "02:00", "A"), s("asleep", "03:30", "07:00", "A")]);
    expect(split).toHaveLength(2);
    expect(split[0].end).toBe(Date.parse(t("02:00")));
  });

  it("measures gaps from the latest end so far (a long in_bed keeps the session together)", () => {
    const sessions = groupSessions([
      s("in_bed", "22:00", "07:00", IPHONE),
      s("asleep", "22:30", "23:00", "Zepp"),
      s("asleep", "03:00", "06:00", "Zepp"),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].start).toBe(Date.parse(t("22:00")));
    expect(sessions[0].end).toBe(Date.parse(t("07:00")));
  });
});

describe("summarizeNight", () => {
  it("Apple Watch night: stages from the watch, in_bed from the iPhone", () => {
    const n = summarizeNight(appleWatchNight, TZ);
    expect(n).toMatchObject({
      wakeDate: "2026-09-28",
      chosenSource: WATCH,
      coreMin: 280,
      deepMin: 75,
      remMin: 100,
      asleepMin: 455,
      awakeMin: 20,
      inBedMin: 495,
      hasStages: true,
      bedStart: Date.parse(t("22:45")),
      bedEnd: Date.parse(t("07:00")),
    });
    expect(n.sources[IPHONE].stages).toEqual(["in_bed"]);
  });

  it("Fitbit night: Light counts as core; in_bed falls back to the sleep span", () => {
    const n = summarizeNight(fitbitNight, TZ);
    expect(n).toMatchObject({
      chosenSource: "Fitbit",
      coreMin: 225,
      deepMin: 60,
      remMin: 90,
      asleepMin: 375,
      awakeMin: 25,
      inBedMin: 400,
      hasStages: true,
      bedStart: Date.parse(t("23:30")),
      bedEnd: Date.parse(t("06:10")),
    });
  });

  it("Zepp night: only asleep + awake, no stage detail", () => {
    const n = summarizeNight(zeppNight, TZ);
    expect(n).toMatchObject({
      chosenSource: "Zepp Life",
      asleepMin: 460,
      awakeMin: 20,
      coreMin: 0,
      deepMin: 0,
      remMin: 0,
      inBedMin: 480,
      hasStages: false,
    });
  });

  it("iPhone only: in_bed, nothing asleep", () => {
    const n = summarizeNight([s("in_bed", "23:00", "07:00", IPHONE)], TZ);
    expect(n).toMatchObject({
      chosenSource: IPHONE,
      inBedMin: 480,
      asleepMin: 0,
      awakeMin: 480,
      hasStages: false,
      bedStart: Date.parse(t("23:00")),
      bedEnd: Date.parse(t("07:00")),
    });
  });

  it("watch + Zepp the same night: the watch wins on stage detail even with less sleep; overlaps don't double count", () => {
    const zepp = [
      s("asleep", "23:10", "03:00", "Zepp Life"),
      s("asleep", "02:00", "06:50", "Zepp Life"), // overlaps the previous one by an hour
    ];
    const n = summarizeNight([...appleWatchNight, ...zepp], TZ);
    expect(n.sources["Zepp Life"].asleepMin).toBe(460); // union, not 230 + 290
    expect(n.sources[WATCH].asleepMin).toBe(455);
    expect(n.chosenSource).toBe(WATCH);
    expect(n.asleepMin).toBe(455);
    expect(n.hasStages).toBe(true);
  });

  it("among sources without stages the longest sleep wins; ties go alphabetically", () => {
    const a = [s("asleep", "23:00", "06:00", "Zepp")];
    const b = [s("asleep", "23:00", "07:00", "Another")];
    expect(summarizeNight([...a, ...b], TZ).chosenSource).toBe("Another");
    const tie = [s("asleep", "23:00", "06:00", "Beta"), s("asleep", "23:00", "06:00", "Alpha")];
    expect(summarizeNight(tie, TZ).chosenSource).toBe("Alpha");
    const tieStages = [s("core", "23:00", "06:00", "Zed"), s("deep", "23:00", "06:00", "Ace")];
    expect(summarizeNight(tieStages, TZ).chosenSource).toBe("Ace");
  });

  it("overlapping stages of one source: asleep is the union across stages", () => {
    const n = summarizeNight(
      [s("core", "23:00", "01:00", "W"), s("deep", "00:30", "02:00", "W"), s("rem", "01:30", "02:30", "W")],
      TZ,
    );
    expect(n.asleepMin).toBe(210);
    expect(n.coreMin).toBe(120);
    expect(n.deepMin).toBe(90);
    expect(n.remMin).toBe(60);
  });

  it("a night crossing midnight belongs to the wake date", () => {
    const n = summarizeNight([s("asleep", "22:00", "06:00", "Z")], TZ);
    expect(n.wakeDate).toBe("2026-09-28");
    // Same instants seen from New York (UTC-4): 16:00 -> 00:00, the wake date is still the 28th there too.
    expect(summarizeNight([s("asleep", "22:00", "06:00", "Z")], "America/New_York").wakeDate).toBe("2026-09-28");
    expect(summarizeNight([s("asleep", "22:00", "05:59", "Z")], "America/New_York").wakeDate).toBe("2026-09-27");
  });

  it("DST fall-back night (Europe/Berlin, Oct 25 2026) counts real elapsed time", () => {
    // 23:00 CEST -> 07:00 CET is 9 hours, although the wall clock moved 8.
    const n = summarizeNight([seg("core", "2026-10-24T23:00:00+02:00", "2026-10-25T07:00:00+01:00", "W")], TZ);
    expect(n.wakeDate).toBe("2026-10-25");
    expect(n.asleepMin).toBe(540);
    expect(n.inBedMin).toBe(540);
  });

  it("DST spring-forward night (Europe/Berlin, Mar 29 2026) is an hour shorter", () => {
    const n = summarizeNight([seg("asleep", "2026-03-28T23:00:00+01:00", "2026-03-29T07:00:00+02:00", "Z")], TZ);
    expect(n.wakeDate).toBe("2026-03-29");
    expect(n.asleepMin).toBe(420);
  });

  it("a night of two sessions (long wake-up in the middle) adds both, without the gap", () => {
    const n = summarizeNight([s("asleep", "23:00", "02:00", "Z"), s("asleep", "04:00", "07:00", "Z")], TZ);
    expect(n.asleepMin).toBe(360);
    expect(n.inBedMin).toBe(360); // per-session spans, not 23:00 -> 07:00
    expect(n.awakeMin).toBe(0);
    expect(n.bedStart).toBe(Date.parse(t("23:00")));
    expect(n.bedEnd).toBe(Date.parse(t("07:00")));
  });
});

describe("buildNights", () => {
  it("ignores naps and groups the rest by wake date", () => {
    const nap = s("asleep", "14:00", "14:40", "Zepp Life"); // 40 min, ends 14:40 on the 27th
    const eveningDoze = seg("asleep", "2026-09-27T20:00:00+02:00", "2026-09-27T20:40:00+02:00", "Zepp Life"); // after 18:00: not a nap
    const longAfternoon = seg("asleep", "2026-09-26T13:00:00+02:00", "2026-09-26T15:00:00+02:00", "Zepp Life"); // 2 h: not a nap
    const { nights, naps } = buildNights([...appleWatchNight, nap, eveningDoze, longAfternoon], TZ);
    expect(naps).toHaveLength(1);
    expect(naps[0].segments).toEqual([nap]);
    expect(nights.map((n) => n.wakeDate)).toEqual(["2026-09-26", "2026-09-27", "2026-09-28"]);
    const night = nights[2];
    expect(night.segments).toHaveLength(appleWatchNight.length);
    expect(night.spans).toEqual([{ start: Date.parse(t("22:45")), end: Date.parse(t("07:00")) }]);
    expect(night.summary.chosenSource).toBe(WATCH);
  });

  it("an in_bed-only midday session is treated as a nap", () => {
    const { nights, naps } = buildNights([s("in_bed", "13:00", "13:30", IPHONE)], TZ);
    expect(nights).toHaveLength(0);
    expect(naps).toHaveLength(1);
  });
});
