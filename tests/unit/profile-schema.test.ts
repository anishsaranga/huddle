import { describe, expect, it } from "vitest";
import {
  ageOn,
  basicsSchema,
  bodySchema,
  cmToFtIn,
  displayNameSchema,
  dobBounds,
  dobSchema,
  estimatedMaxHr,
  fieldErrors,
  formatHeight,
  formatSleepGoal,
  formatWeight,
  ftInToCm,
  goalsSchema,
  kgToLb,
  lbToKg,
  maxHrSchema,
  personalSchema,
  RESERVED_USERNAMES,
  sleepGoalSchema,
  stepGoalSchema,
  usernameSchema,
} from "@/lib/profile/schema";
import { incompleteSteps, resumeStep, type DraftFields } from "@/lib/profile/progress";

describe("usernameSchema", () => {
  it("lowercases and trims", () => {
    expect(usernameSchema.parse("  Alex_Runs  ")).toBe("alex_runs");
  });

  it("accepts 3-20 chars of a-z 0-9 _", () => {
    expect(usernameSchema.safeParse("abc").success).toBe(true);
    expect(usernameSchema.safeParse("a".repeat(20)).success).toBe(true);
    expect(usernameSchema.safeParse("user_123").success).toBe(true);
  });

  it("rejects too short, too long and bad characters", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(21)).success).toBe(false);
    for (const bad of ["has space", "dash-ed", "dot.ted", "émile", "@alex", "a/b", ""]) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("blocks reserved words in any case", () => {
    for (const word of ["admin", "api", "huddle", "support", "root", "ADMIN", "Huddle"]) {
      const r = usernameSchema.safeParse(word);
      expect(r.success, word).toBe(false);
    }
    expect(RESERVED_USERNAMES.has("admin")).toBe(true);
    // Reserved words only block exact matches.
    expect(usernameSchema.safeParse("admin2").success).toBe(true);
    expect(usernameSchema.safeParse("rooted").success).toBe(true);
  });
});

describe("displayNameSchema", () => {
  it("trims and enforces 1-40 chars", () => {
    expect(displayNameSchema.parse("  Alex  ")).toBe("Alex");
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
    expect(displayNameSchema.safeParse("x".repeat(40)).success).toBe(true);
    expect(displayNameSchema.safeParse("x".repeat(41)).success).toBe(false);
  });
});

describe("date of birth", () => {
  const now = new Date("2026-09-29T12:00:00Z");

  it("computes whole-year age with birthdays", () => {
    expect(ageOn("2000-09-29", now)).toBe(26);
    expect(ageOn("2000-09-30", now)).toBe(25);
    expect(ageOn("2000-01-01", now)).toBe(26);
    expect(ageOn("2026-09-29", now)).toBe(0);
  });

  it("returns NaN for malformed or impossible dates", () => {
    expect(ageOn("nope", now)).toBeNaN();
    expect(ageOn("2001-02-29", now)).toBeNaN();
    expect(ageOn("2001-13-01", now)).toBeNaN();
  });

  it("dobBounds match the 13-100 rule", () => {
    const { min, max } = dobBounds(now);
    expect(max).toBe("2013-09-29"); // exactly 13 today
    expect(min).toBe("1925-09-29"); // 101 today: one day too old
    expect(ageOn(max, now)).toBe(13);
    expect(ageOn(min, now)).toBe(101);
  });

  // dobSchema uses the real clock, so build dates relative to today.
  const yearsAgo = (years: number, dayOffset = 0) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  };

  it("accepts 13 through 100 years old", () => {
    expect(dobSchema.safeParse(yearsAgo(13)).success).toBe(true);
    expect(dobSchema.safeParse(yearsAgo(30)).success).toBe(true);
    expect(dobSchema.safeParse(yearsAgo(100)).success).toBe(true);
  });

  it("rejects under 13, over 100, future and invalid dates", () => {
    expect(dobSchema.safeParse(yearsAgo(13, 2)).success).toBe(false); // turns 13 in 2 days
    expect(dobSchema.safeParse(yearsAgo(5)).success).toBe(false);
    expect(dobSchema.safeParse(yearsAgo(-1)).success).toBe(false);
    expect(dobSchema.safeParse(yearsAgo(101, -2)).success).toBe(false);
    expect(dobSchema.safeParse("1990-02-30").success).toBe(false);
    expect(dobSchema.safeParse("").success).toBe(false);
    expect(dobSchema.safeParse("1990/01/01").success).toBe(false);
  });
});

describe("body schema", () => {
  it("accepts sensible values and an optional max HR", () => {
    expect(bodySchema.safeParse({ heightCm: 178, weightKg: 75, maxHr: null }).success).toBe(true);
    expect(bodySchema.safeParse({ heightCm: 178, weightKg: 75, maxHr: 190 }).success).toBe(true);
  });

  it("bounds height and weight", () => {
    expect(bodySchema.safeParse({ heightCm: 99, weightKg: 75, maxHr: null }).success).toBe(false);
    expect(bodySchema.safeParse({ heightCm: 251, weightKg: 75, maxHr: null }).success).toBe(false);
    expect(bodySchema.safeParse({ heightCm: 178, weightKg: 29, maxHr: null }).success).toBe(false);
    expect(bodySchema.safeParse({ heightCm: 178, weightKg: 301, maxHr: null }).success).toBe(false);
    expect(bodySchema.safeParse({ heightCm: null, weightKg: 75, maxHr: null }).success).toBe(false);
    expect(bodySchema.safeParse({ heightCm: NaN, weightKg: 75, maxHr: null }).success).toBe(false);
  });

  it("bounds max HR to 100-230 whole bpm", () => {
    expect(maxHrSchema.safeParse(100).success).toBe(true);
    expect(maxHrSchema.safeParse(230).success).toBe(true);
    expect(maxHrSchema.safeParse(99).success).toBe(false);
    expect(maxHrSchema.safeParse(231).success).toBe(false);
    expect(maxHrSchema.safeParse(180.5).success).toBe(false);
  });

  it("estimates max HR as 208 - 0.7 x age", () => {
    expect(estimatedMaxHr(30)).toBe(187);
    expect(estimatedMaxHr(20)).toBe(194);
    expect(estimatedMaxHr(60)).toBe(166);
  });
});

describe("goals", () => {
  it("bounds steps to 1,000-50,000", () => {
    expect(stepGoalSchema.safeParse(1000).success).toBe(true);
    expect(stepGoalSchema.safeParse(50000).success).toBe(true);
    expect(stepGoalSchema.safeParse(999).success).toBe(false);
    expect(stepGoalSchema.safeParse(50001).success).toBe(false);
    expect(stepGoalSchema.safeParse(8000.5).success).toBe(false);
  });

  it("bounds sleep to 5-12h in 15-minute steps", () => {
    expect(sleepGoalSchema.safeParse(300).success).toBe(true);
    expect(sleepGoalSchema.safeParse(480).success).toBe(true);
    expect(sleepGoalSchema.safeParse(720).success).toBe(true);
    expect(sleepGoalSchema.safeParse(285).success).toBe(false);
    expect(sleepGoalSchema.safeParse(735).success).toBe(false);
    expect(sleepGoalSchema.safeParse(485).success).toBe(false);
  });

  it("formats sleep goals", () => {
    expect(formatSleepGoal(480)).toBe("8h 00m");
    expect(formatSleepGoal(465)).toBe("7h 45m");
  });
});

describe("section schemas", () => {
  it("basics needs a real timezone, units, dob and sex", () => {
    const ok = { timezone: "Europe/London", units: "metric", dob: "1990-05-05", sex: "female" };
    expect(basicsSchema.safeParse(ok).success).toBe(true);
    expect(basicsSchema.safeParse({ ...ok, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(basicsSchema.safeParse({ ...ok, units: "cubits" }).success).toBe(false);
    expect(basicsSchema.safeParse({ ...ok, sex: "robot" }).success).toBe(false);
  });

  it("accepts every sex option", () => {
    for (const sex of ["male", "female", "other", "unspecified"]) {
      expect(personalSchema.safeParse({ displayName: "A", username: "abc", dob: "1990-05-05", sex }).success).toBe(true);
    }
  });

  it("fieldErrors reports the first message per field", () => {
    const e = fieldErrors(goalsSchema, { stepGoal: 5, sleepGoalMin: 481 });
    expect(Object.keys(e).sort()).toEqual(["sleepGoalMin", "stepGoal"]);
    expect(fieldErrors(goalsSchema, { stepGoal: 8000, sleepGoalMin: 480 })).toEqual({});
  });
});

describe("unit conversions", () => {
  it("converts known values", () => {
    expect(ftInToCm(5, 10)).toBe(177.8);
    expect(ftInToCm(6, 0)).toBe(182.9);
    expect(cmToFtIn(177.8)).toEqual({ ft: 5, in: 10 });
    expect(lbToKg(165)).toBe(74.84);
    expect(kgToLb(75)).toBe(165.3);
  });

  it("round-trips every whole ft/in through cm", () => {
    for (let ft = 3; ft <= 8; ft++) {
      for (let inch = 0; inch < 12; inch++) {
        expect(cmToFtIn(ftInToCm(ft, inch))).toEqual({ ft, in: inch });
      }
    }
  });

  it("rolls 11.6 inches over to the next foot", () => {
    // 5'11.6" is 181.9 cm, which displays as 6'0".
    expect(cmToFtIn(181.9)).toEqual({ ft: 6, in: 0 });
  });

  it("round-trips pounds through kg (0.1 lb resolution)", () => {
    for (let lb = 70; lb <= 660; lb += 0.5) {
      expect(kgToLb(lbToKg(lb))).toBeCloseTo(lb, 1);
    }
    for (const lb of [99.9, 123.4, 187.3, 250.1]) {
      expect(kgToLb(lbToKg(lb))).toBe(lb);
    }
  });

  it("round-trips kg through lb within display precision", () => {
    for (let kg = 35; kg <= 250; kg += 0.5) {
      expect(Math.abs(lbToKg(kgToLb(kg)) - kg)).toBeLessThan(0.05);
    }
  });

  it("formats by unit system", () => {
    expect(formatHeight(177.8, "imperial")).toBe("5′10″");
    expect(formatHeight(177.8, "metric")).toBe("178 cm");
    expect(formatWeight(74.84, "imperial")).toBe("165 lb");
    expect(formatWeight(75, "metric")).toBe("75 kg");
  });
});

describe("onboarding progress", () => {
  const empty: DraftFields = {
    username: null,
    displayName: null,
    avatarKind: null,
    timezone: null,
    units: null,
    dob: null,
    sex: null,
    heightCm: null,
    weightKg: null,
    stepGoal: null,
    sleepGoalMin: null,
  };

  it("resumes at the first incomplete step", () => {
    expect(resumeStep(empty)).toBe("identity");
    const identity = { ...empty, username: "abc", displayName: "A" };
    expect(resumeStep(identity)).toBe("avatar");
    const avatar = { ...identity, avatarKind: "dicebear" };
    expect(resumeStep(avatar)).toBe("basics");
    const basics = { ...avatar, timezone: "UTC", units: "metric", dob: "1990-01-01", sex: "male" };
    expect(resumeStep(basics)).toBe("body");
    const body = { ...basics, heightCm: 180, weightKg: 80 };
    expect(resumeStep(body)).toBe("goals");
    const done = { ...body, stepGoal: 8000, sleepGoalMin: 480 };
    expect(resumeStep(done)).toBe("connect");
    expect(incompleteSteps(done)).toEqual([]);
  });
});
