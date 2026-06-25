import { DateTime } from "luxon";
import type { EventConfig } from "./types";

/**
 * Time / grid geometry helpers.
 *
 * The grid is anchored to the organizer's timezone: each column is one calendar
 * date in `organizer_timezone`, and the vertical axis spans the daily window
 * [day_start_minute, day_end_minute] of that date. Each column therefore maps
 * to a fixed UTC span. Availability is stored and compared in UTC, so blocks
 * position identically regardless of the viewer; only the *labels* change with
 * the active display timezone.
 */

export interface GridColumn {
  /** Calendar date in the organizer timezone, 'YYYY-MM-DD'. */
  dateISO: string;
  /** UTC epoch ms of day_start_minute on this date. */
  startMs: number;
  /** UTC epoch ms of day_end_minute on this date. */
  endMs: number;
}

/** The browser's IANA timezone (client-only). */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Inclusive list of calendar dates 'YYYY-MM-DD' from start_date to end_date. */
export function eventDates(ev: EventConfig): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(ev.start_date);
  const end = DateTime.fromISO(ev.end_date);
  // Guard against an unbounded loop on bad input.
  let guard = 0;
  while (d <= end && guard < 366) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
    guard++;
  }
  return out;
}

/** UTC epoch ms for a given minute-of-day on a date, in the organizer timezone. */
export function instantMs(
  dateISO: string,
  minuteOfDay: number,
  zone: string,
): number {
  return DateTime.fromISO(dateISO, { zone })
    .startOf("day")
    .plus({ minutes: minuteOfDay })
    .toMillis();
}

/** Build the grid columns for an event. */
export function gridColumns(ev: EventConfig): GridColumn[] {
  return eventDates(ev).map((dateISO) => ({
    dateISO,
    startMs: instantMs(dateISO, ev.day_start_minute, ev.organizer_timezone),
    endMs: instantMs(dateISO, ev.day_end_minute, ev.organizer_timezone),
  }));
}

/** Total minutes in the daily window. */
export function windowMinutes(ev: EventConfig): number {
  return ev.day_end_minute - ev.day_start_minute;
}

/**
 * Intersect a UTC interval with a column. Returns top/bottom fractions
 * (0 = column top, 1 = column bottom) or null if there is no overlap.
 */
export function clipToColumn(
  startMs: number,
  endMs: number,
  col: GridColumn,
): { topFrac: number; bottomFrac: number } | null {
  const s = Math.max(startMs, col.startMs);
  const e = Math.min(endMs, col.endMs);
  if (e <= s) return null;
  const span = col.endMs - col.startMs;
  return {
    topFrac: (s - col.startMs) / span,
    bottomFrac: (e - col.startMs) / span,
  };
}

/** Snap a UTC instant within a column to the nearest snap_minutes boundary. */
export function snapMs(ms: number, col: GridColumn, snapMinutes: number): number {
  const step = snapMinutes * 60_000;
  const snapped = col.startMs + Math.round((ms - col.startMs) / step) * step;
  return Math.min(Math.max(snapped, col.startMs), col.endMs);
}

/** Convert a vertical fraction within a column to a UTC instant. */
export function fracToMs(frac: number, col: GridColumn): number {
  const f = Math.min(Math.max(frac, 0), 1);
  return col.startMs + f * (col.endMs - col.startMs);
}

/** Hour-tick marks for the vertical axis, labeled in the active display tz. */
export function timeAxisTicks(
  ev: EventConfig,
  displayTz: string,
): { frac: number; label: string }[] {
  const ticks: { frac: number; label: string }[] = [];
  const win = windowMinutes(ev);
  const refDate = ev.start_date;
  // First hour boundary at or after day_start_minute.
  const firstHour = Math.ceil(ev.day_start_minute / 60) * 60;
  for (let m = firstHour; m <= ev.day_end_minute; m += 60) {
    const ms = instantMs(refDate, m, ev.organizer_timezone);
    ticks.push({
      frac: (m - ev.day_start_minute) / win,
      label: DateTime.fromMillis(ms, { zone: displayTz }).toFormat("h a"),
    });
  }
  return ticks;
}

/** Column header label: weekday + date in the active display tz. */
export function columnLabel(col: GridColumn, displayTz: string): {
  weekday: string;
  day: string;
} {
  const dt = DateTime.fromMillis(col.startMs, { zone: displayTz });
  return { weekday: dt.toFormat("ccc"), day: dt.toFormat("LLL d") };
}

/** Format a UTC instant range as a human label in the active display tz. */
export function formatRange(
  startMs: number,
  endMs: number,
  displayTz: string,
): string {
  const s = DateTime.fromMillis(startMs, { zone: displayTz });
  const e = DateTime.fromMillis(endMs, { zone: displayTz });
  const sameDay = s.hasSame(e, "day");
  const date = s.toFormat("ccc LLL d");
  if (sameDay) {
    return `${date}, ${s.toFormat("h:mm a")} – ${e.toFormat("h:mm a")}`;
  }
  return `${s.toFormat("ccc LLL d, h:mm a")} – ${e.toFormat("ccc LLL d, h:mm a")}`;
}

/** Short time label for a single instant in the active display tz. */
export function formatTime(ms: number, displayTz: string): string {
  return DateTime.fromMillis(ms, { zone: displayTz }).toFormat("h:mm a");
}

/** Human label for minute-of-day (used in the event creation form). */
export function minuteLabel(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const dt = DateTime.fromObject({ hour: h, minute: m });
  return dt.toFormat("h:mm a");
}
