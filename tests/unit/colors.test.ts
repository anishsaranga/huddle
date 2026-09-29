import { describe, it, expect } from "vitest";
import {
  recoveryBand,
  recoveryColor,
  SIGNAL,
} from "@/lib/ui/colors";

describe("recoveryBand", () => {
  describe("green boundary (67)", () => {
    it("should return 'green' for 67", () => {
      expect(recoveryBand(67)).toBe("green");
    });

    it("should return 'green' for 100", () => {
      expect(recoveryBand(100)).toBe("green");
    });
  });

  describe("yellow boundary (34-66)", () => {
    it("should return 'yellow' for 66", () => {
      expect(recoveryBand(66)).toBe("yellow");
    });

    it("should return 'yellow' for 34", () => {
      expect(recoveryBand(34)).toBe("yellow");
    });

    it("should return 'yellow' for 50", () => {
      expect(recoveryBand(50)).toBe("yellow");
    });
  });

  describe("red boundary (33)", () => {
    it("should return 'red' for 33", () => {
      expect(recoveryBand(33)).toBe("red");
    });

    it("should return 'red' for 0", () => {
      expect(recoveryBand(0)).toBe("red");
    });
  });
});

describe("recoveryColor", () => {
  it("should return green color var for values >= 67", () => {
    expect(recoveryColor(67)).toBe(SIGNAL.green);
    expect(recoveryColor(100)).toBe(SIGNAL.green);
  });

  it("should return yellow color var for values 34-66", () => {
    expect(recoveryColor(34)).toBe(SIGNAL.yellow);
    expect(recoveryColor(50)).toBe(SIGNAL.yellow);
    expect(recoveryColor(66)).toBe(SIGNAL.yellow);
  });

  it("should return red color var for values <= 33", () => {
    expect(recoveryColor(33)).toBe(SIGNAL.red);
    expect(recoveryColor(0)).toBe(SIGNAL.red);
  });
});
