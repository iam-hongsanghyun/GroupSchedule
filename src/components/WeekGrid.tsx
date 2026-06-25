"use client";

import { useCallback, useEffect, useRef } from "react";
import type { EventConfig } from "@/lib/types";
import type { OverlapSegment } from "@/lib/scheduling";
import {
  type GridColumn,
  columnLabel,
  timeAxisTicks,
  fracToMs,
  snapMs,
  clipToColumn,
  formatTime,
} from "@/lib/time";

/** An availability block being edited, as a UTC epoch-ms interval. */
export interface EditBlock {
  id: string;
  startMs: number;
  endMs: number;
}

const HOUR_PX = 44;

interface DragState {
  kind: "create" | "move" | "resize-top" | "resize-bottom";
  colIndex: number;
  rectTop: number;
  rectH: number;
  blockId: string;
  anchorMs: number; // create: fixed anchor; move: grab offset from block start
}

interface Props {
  ev: EventConfig;
  columns: GridColumn[];
  displayTz: string;
  refDateISO: string;
  overlap: OverlapSegment[];
  maxCount: number;
  myBlocks: EditBlock[];
  setMyBlocks: (updater: (prev: EditBlock[]) => EditBlock[]) => void;
  editable: boolean;
  scrollToMinute?: number;
  busy?: { start: number; end: number }[];
  finalized?: { start: number; end: number } | null;
}

/**
 * Overlap shading: a single person available is barely visible; once two or
 * more overlap it brightens sharply, and "everyone" is the most saturated.
 */
function segColor(count: number, maxCount: number): string {
  if (count <= 1) return "rgba(16,185,129,0.08)"; // single availability — faint
  const t = maxCount > 1 ? (count - 1) / (maxCount - 1) : 1; // 0 at two → 1 at everyone
  const op = 0.34 + 0.5 * t; // 0.34 … 0.84
  return `rgba(16,185,129,${op})`; // emerald-500
}

function newId(seed: number): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tmp-${seed}`;
}

export function WeekGrid({
  ev,
  columns,
  displayTz,
  refDateISO,
  overlap,
  maxCount,
  myBlocks,
  setMyBlocks,
  editable,
  scrollToMinute = 480,
  busy = [],
  finalized = null,
}: Props) {
  const windowMin = ev.day_end_minute - ev.day_start_minute;
  const H = (windowMin / 60) * HOUR_PX;
  const minLenMs = ev.snap_minutes * 60_000;
  const ticks = timeAxisTicks(ev, displayTz, refDateISO);

  const dragRef = useRef<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Default the vertical scroll to a daytime hour.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = ((scrollToMinute - ev.day_start_minute) / windowMin) * H;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMove = useCallback(
    (clientY: number) => {
      const d = dragRef.current;
      if (!d) return;
      const col = columns[d.colIndex];
      if (!col) return;
      const frac = (clientY - d.rectTop) / d.rectH;
      const ms = snapMs(fracToMs(frac, col), col, ev.snap_minutes);

      setMyBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== d.blockId) return b;
          if (d.kind === "create") {
            return { ...b, startMs: Math.min(d.anchorMs, ms), endMs: Math.max(d.anchorMs, ms) };
          }
          if (d.kind === "resize-top") {
            return { ...b, startMs: Math.min(ms, b.endMs - minLenMs) };
          }
          if (d.kind === "resize-bottom") {
            return { ...b, endMs: Math.max(ms, b.startMs + minLenMs) };
          }
          const len = b.endMs - b.startMs;
          let start = ms - d.anchorMs;
          start = Math.min(Math.max(start, col.startMs), col.endMs - len);
          return { ...b, startMs: start, endMs: start + len };
        }),
      );
    },
    [columns, ev.snap_minutes, minLenMs, setMyBlocks],
  );

  const onUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind === "create") {
      setMyBlocks((prev) =>
        prev.filter((b) => b.id !== d.blockId || b.endMs - b.startMs >= minLenMs),
      );
    }
  }, [minLenMs, setMyBlocks]);

  useEffect(() => {
    const move = (e: PointerEvent) => onMove(e.clientY);
    const up = () => onUp();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [onMove, onUp]);

  function colRectFrom(target: EventTarget | null): DOMRect | null {
    const el = (target as HTMLElement | null)?.closest(
      "[data-col-index]",
    ) as HTMLElement | null;
    return el ? el.getBoundingClientRect() : null;
  }

  function beginCreate(colIndex: number, e: React.PointerEvent) {
    if (!editable) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const col = columns[colIndex];
    const start = snapMs(fracToMs((e.clientY - rect.top) / rect.height, col), col, ev.snap_minutes);
    const id = newId(start);
    dragRef.current = {
      kind: "create",
      colIndex,
      rectTop: rect.top,
      rectH: rect.height,
      blockId: id,
      anchorMs: start,
    };
    setMyBlocks((prev) => [...prev, { id, startMs: start, endMs: start }]);
    e.preventDefault();
  }

  function beginMove(block: EditBlock, colIndex: number, e: React.PointerEvent) {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = colRectFrom(e.currentTarget);
    if (!rect) return;
    const col = columns[colIndex];
    const ms = snapMs(fracToMs((e.clientY - rect.top) / rect.height, col), col, ev.snap_minutes);
    dragRef.current = {
      kind: "move",
      colIndex,
      rectTop: rect.top,
      rectH: rect.height,
      blockId: block.id,
      anchorMs: ms - block.startMs,
    };
  }

  function beginResize(
    block: EditBlock,
    colIndex: number,
    edge: "resize-top" | "resize-bottom",
    e: React.PointerEvent,
  ) {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = colRectFrom(e.currentTarget);
    if (!rect) return;
    dragRef.current = {
      kind: edge,
      colIndex,
      rectTop: rect.top,
      rectH: rect.height,
      blockId: block.id,
      anchorMs: 0,
    };
  }

  function deleteBlock(id: string, e: React.PointerEvent) {
    e.stopPropagation();
    setMyBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  const innerMinWidth = 56 + columns.length * 92;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div style={{ minWidth: innerMinWidth }}>
        {/* Header row (stays visible above the vertical scroll) */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <div className="w-14 shrink-0" />
          {columns.map((col, i) => {
            const { weekday, day } = columnLabel(col, displayTz);
            return (
              <div key={i} className="flex-1 border-l border-slate-200 py-2 text-center">
                <div className="text-xs font-medium uppercase text-slate-400">{weekday}</div>
                <div className="text-sm font-semibold text-slate-700">{day}</div>
              </div>
            );
          })}
        </div>

        {/* Scrollable body */}
        <div ref={scrollRef} className="flex overflow-y-auto" style={{ maxHeight: 560 }}>
          {/* Time axis */}
          <div className="relative w-14 shrink-0" style={{ height: H }}>
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-slate-400"
                style={{ top: t.frac * H }}
              >
                {t.label}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {columns.map((col, ci) => (
            <div
              key={ci}
              data-col-index={ci}
              onPointerDown={(e) => beginCreate(ci, e)}
              className={`no-select relative flex-1 border-l border-slate-200 ${
                editable ? "cursor-crosshair" : ""
              }`}
              style={{ height: H }}
            >
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute inset-x-0 border-t border-slate-100"
                  style={{ top: t.frac * H }}
                />
              ))}

              {/* Google Calendar busy times (read-only, behind everything) */}
              {busy.map((b, i) => {
                const clip = clipToColumn(b.start, b.end, col);
                if (!clip) return null;
                const top = clip.topFrac * H;
                const height = (clip.bottomFrac - clip.topFrac) * H;
                return (
                  <div
                    key={`b-${i}`}
                    className="pointer-events-none absolute inset-x-0 rounded-sm"
                    style={{
                      top,
                      height,
                      backgroundColor: "rgba(100,116,139,0.10)",
                      backgroundImage:
                        "repeating-linear-gradient(45deg, rgba(100,116,139,0.22) 0, rgba(100,116,139,0.22) 1px, transparent 1px, transparent 6px)",
                    }}
                  >
                    {height > 16 && (
                      <span className="absolute left-1 top-0.5 text-[9px] font-medium text-slate-500">
                        busy
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Overlap (read-only) */}
              {overlap.map((seg, i) => {
                const clip = clipToColumn(seg.start, seg.end, col);
                if (!clip) return null;
                const top = clip.topFrac * H;
                const height = (clip.bottomFrac - clip.topFrac) * H;
                const everyone = maxCount >= 2 && seg.count === maxCount;
                return (
                  <div
                    key={`o-${i}`}
                    className={`pointer-events-none absolute inset-x-0.5 overflow-hidden rounded-sm ${
                      everyone ? "ring-1 ring-inset ring-emerald-600" : ""
                    }`}
                    style={{ top, height, background: segColor(seg.count, maxCount) }}
                  >
                    {height > 16 && (
                      <span className="absolute right-1 top-0.5 text-[10px] font-semibold text-emerald-900/80">
                        {everyone ? `all ${seg.count}` : seg.count}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* My editable blocks (each lives in exactly one day-column) */}
              {myBlocks.map((b) => {
                const clip = clipToColumn(b.startMs, b.endMs, col);
                if (!clip) return null;
                const top = clip.topFrac * H;
                const height = Math.max((clip.bottomFrac - clip.topFrac) * H, 2);
                return (
                  <div
                    key={b.id}
                    onPointerDown={(e) => beginMove(b, ci, e)}
                    className="absolute inset-x-0.5 rounded-md border border-indigo-500 bg-indigo-500/30 text-[10px] text-indigo-900 shadow-sm"
                    style={{ top, height, cursor: editable ? "move" : "default" }}
                  >
                    {editable && (
                      <>
                        <div
                          onPointerDown={(e) => beginResize(b, ci, "resize-top", e)}
                          className="absolute inset-x-0 top-0 h-2 cursor-ns-resize"
                        />
                        <div
                          onPointerDown={(e) => beginResize(b, ci, "resize-bottom", e)}
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        />
                        <button
                          type="button"
                          onPointerDown={(e) => deleteBlock(b.id, e)}
                          className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded bg-white/80 text-indigo-700 hover:bg-white"
                          aria-label="Remove block"
                        >
                          ×
                        </button>
                      </>
                    )}
                    {height > 22 && (
                      <span className="pointer-events-none absolute left-1 top-0.5 font-medium">
                        {formatTime(b.startMs, displayTz)}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Finalized meeting time (read-only highlight) */}
              {finalized &&
                (() => {
                  const clip = clipToColumn(finalized.start, finalized.end, col);
                  if (!clip) return null;
                  const top = clip.topFrac * H;
                  const height = Math.max((clip.bottomFrac - clip.topFrac) * H, 14);
                  return (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded-md bg-indigo-600 px-1 py-0.5 text-[10px] font-semibold text-white shadow ring-2 ring-indigo-300"
                      style={{ top, height }}
                    >
                      ★ Scheduled
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
