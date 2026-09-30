import { describe, expect, it } from "vitest";
import { assertTestDatabase, assertValidSlot, slotDatabaseName } from "../support/test-db";

const url = (db: string) => `postgres://huddle:huddle@localhost:5433/${db}`;

describe("assertTestDatabase", () => {
  it("accepts huddle_test and per-slot copies", () => {
    expect(() => assertTestDatabase(url("huddle_test"))).not.toThrow();
    expect(() => assertTestDatabase(url("huddle_test_w0a"))).not.toThrow();
    expect(() => assertTestDatabase(url("huddle_test_a_1"))).not.toThrow();
  });

  it("refuses non-test databases", () => {
    const bad = ["huddle", "postgres", "prod_test", "huddle_test_", "huddle_testing", "huddle_test_A", "huddle_test_a-b", `huddle_test_${"x".repeat(21)}`];
    for (const db of bad) expect(() => assertTestDatabase(url(db)), db).toThrow(/Refusing/);
  });
});

describe("slots", () => {
  it("validates slot names", () => {
    expect(slotDatabaseName("w0a")).toBe("huddle_test_w0a");
    for (const s of ["", "A", "a-b", "a b", 'a"; drop database huddle; --', "x".repeat(21)]) {
      expect(() => assertValidSlot(s), s).toThrow(/Invalid slot/);
    }
  });
});
