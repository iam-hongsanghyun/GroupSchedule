import { describe, it, expect } from "vitest";
import {
  mergeBlocks,
  computeOverlap,
  suggestWindows,
} from "@/lib/scheduling";
import type { ParticipantResponse } from "@/lib/types";

// All instants are UTC; the engine never touches timezones.
const D = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 5, 30, h, m)).toISOString();

function person(id: string, ...ranges: [number, number][]): ParticipantResponse {
  return {
    participant_id: id,
    display_name: id,
    timezone: "UTC",
    blocks: ranges.map(([s, e]) => ({ start: D(s), end: D(e) })),
  };
}

describe("mergeBlocks", () => {
  it("merges overlapping and touching intervals", () => {
    const merged = mergeBlocks([
      { start: D(9), end: D(10) },
      { start: D(10), end: D(11) }, // touches the previous one
      { start: D(13), end: D(14) }, // separate
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].end - merged[0].start).toBe(2 * 3600_000);
  });
});

describe("computeOverlap", () => {
  it("counts simultaneous availability across a sweep", () => {
    // p1: 10–12, p2: 11–13  =>  10–11 (1), 11–12 (2), 12–13 (1)
    const segs = computeOverlap([
      person("p1", [10, 12]),
      person("p2", [11, 13]),
    ]);
    const two = segs.find((s) => s.count === 2);
    expect(two).toBeDefined();
    expect(two!.start).toBe(Date.parse(D(11)));
    expect(two!.end).toBe(Date.parse(D(12)));
    expect(two!.participantIds.sort()).toEqual(["p1", "p2"]);
  });

  it("returns nothing when no one is available", () => {
    expect(computeOverlap([person("p1")])).toEqual([]);
  });
});

describe("suggestWindows", () => {
  const people = [person("p1", [10, 12]), person("p2", [11, 13])];

  it("treats duration as a minimum and proposes a fitting start", () => {
    // overlap is exactly 11–12 (60 min) with 2 people
    const out = suggestWindows(people, 60, 2);
    expect(out).toHaveLength(1);
    expect(out[0].start).toBe(Date.parse(D(11)));
    expect(out[0].end).toBe(Date.parse(D(12)));
    expect(out[0].count).toBe(2);
  });

  it("drops windows shorter than the requested duration", () => {
    // 90 min meeting cannot fit in the 60 min overlap
    expect(suggestWindows(people, 90, 2)).toHaveLength(0);
  });

  it("ranks larger groups before smaller ones", () => {
    const three = [
      person("p1", [9, 12]),
      person("p2", [9, 12]),
      person("p3", [9, 10]), // only p3 leaves at 10, so 9–10 has all 3
    ];
    const out = suggestWindows(three, 30, 3);
    expect(out[0].count).toBe(3);
    expect(out[0].start).toBe(Date.parse(D(9)));
  });
});
