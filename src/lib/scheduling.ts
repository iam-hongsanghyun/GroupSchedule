import type { Block, ParticipantResponse } from "./types";

/**
 * Interval-based overlap engine.
 *
 * Availability is a set of free-form [start, end) windows per participant. A
 * sweep over all endpoints yields contiguous segments, each tagged with the set
 * of participants free during it. Suggested meeting windows are the segments
 * long enough to fit the (guideline) meeting duration, ranked by how many
 * people are free.
 *
 * Algorithm (sweep line):
 *   events = ∪ {(start,+1),(end,-1)} over every participant's merged blocks
 *   sort by time; between consecutive breakpoints the active set is constant
 *   => segment(count, members)
 */

export interface Interval {
  start: number; // epoch ms
  end: number;
}

export interface OverlapSegment {
  start: number; // epoch ms
  end: number;
  count: number;
  participantIds: string[];
}

export interface SuggestedWindow {
  start: number; // epoch ms — proposed meeting start
  end: number; // start + duration
  freeUntil: number; // end of the overlap segment this sits in
  count: number; // people free
  total: number; // total responders
  participantIds: string[];
}

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

/** Merge one participant's blocks into disjoint, sorted intervals. */
export function mergeBlocks(blocks: Block[]): Interval[] {
  const ivs = blocks
    .map((b) => ({ start: toMs(b.start), end: toMs(b.end) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  const out: Interval[] = [];
  for (const cur of ivs) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Sweep-line over all participants' intervals → contiguous segments tagged with
 * the set of participants available during each.
 */
export function computeOverlap(
  participants: ParticipantResponse[],
): OverlapSegment[] {
  type Ev = { t: number; delta: number; id: string };
  const events: Ev[] = [];
  for (const p of participants) {
    for (const iv of mergeBlocks(p.blocks)) {
      events.push({ t: iv.start, delta: +1, id: p.participant_id });
      events.push({ t: iv.end, delta: -1, id: p.participant_id });
    }
  }
  if (events.length === 0) return [];

  // Process exits (-1) before entries (+1) at the same instant.
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);

  const points = Array.from(new Set(events.map((e) => e.t))).sort(
    (a, b) => a - b,
  );

  const active = new Map<string, number>();
  const segs: OverlapSegment[] = [];
  let ei = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const t = points[i];
    while (ei < events.length && events[ei].t === t) {
      const e = events[ei++];
      const c = (active.get(e.id) ?? 0) + e.delta;
      if (c <= 0) active.delete(e.id);
      else active.set(e.id, c);
    }
    const segStart = t;
    const segEnd = points[i + 1];
    if (active.size > 0 && segEnd > segStart) {
      segs.push({
        start: segStart,
        end: segEnd,
        count: active.size,
        participantIds: [...active.keys()],
      });
    }
  }

  // Merge adjacent segments that share the same participant set.
  const merged: OverlapSegment[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.end === s.start &&
      last.count === s.count &&
      last.participantIds.length === s.participantIds.length &&
      last.participantIds.every((id) => s.participantIds.includes(id))
    ) {
      last.end = s.end;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/**
 * Rank meeting windows. The duration is a guideline: keep overlap segments at
 * least that long and propose a meeting starting at each segment's start. A
 * meeting needs at least two participants.
 */
export function suggestWindows(
  participants: ParticipantResponse[],
  durationMinutes: number,
  total: number,
): SuggestedWindow[] {
  const durMs = durationMinutes * 60_000;
  const segs = computeOverlap(participants).filter(
    (s) => s.count >= 2 && s.end - s.start >= durMs,
  );
  segs.sort((a, b) => b.count - a.count || a.start - b.start);
  return segs.map((s) => ({
    start: s.start,
    end: s.start + durMs,
    freeUntil: s.end,
    count: s.count,
    total,
    participantIds: s.participantIds,
  }));
}
