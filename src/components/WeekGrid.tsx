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

/** An availability block being edited, in UTC epoch ms, anchored to a column. */
export interface EditBlock {
  id: string;
  colIndex: number;
  startMs: number;
  endMs: number;
}

const HOUR_PX = 52;

interface DragState {
  kind: "create" | "move" | "resize-top" | "resize-bottom";
  colIndex: number;
  rectTop: number;
  rectH: number;
  blockId: string;
  anchorMs: number; // create: fixed anchor; move: grab offset from start
}

interface Props {
  ev: EventConfig;
  columns: GridColumn[];
  displayTz: string;
  overlap: OverlapSegment[];
  maxCount: number;
  myBlocks: EditBlock[];
  setMyBlocks: (updater: (prev: EditBlock[]) => EditBlock[]) => void;
  editable: boolean;
}

function segColor(count: number, maxCount: number): string {
  const t = maxCount > 0 ? count / maxCount : 0;
  const op = 0.16 + 0.5 * t;
  return `rgba(16,185,129,${op})`; // emerald-500
}

export function WeekGrid({
  ev,
  columns,
  displayTz,
  overlap,
  maxCount,
  myBlocks,
  setMyBlocks,
  editable,
}: Props) {
  const windowMin = ev.day_end_minute - ev.day_start_minute;
  const H = (windowMin / 60) * HOUR_PX;
  const minLenMs = ev.snap_minutes * 60_000;
  const ticks = timeAxisTicks(ev, displayTz);

  // Mutable drag state — no re-render needed while dragging.
  const dragRef = useRef<DragState | null>(null);

  const pointerMsFor = useCallback(
    (d: DragState, clientY: number): number => {
      const col = columns[d.colIndex];
      const frac = (clientY - d.rectTop) / d.rectH;
      return snapMs(fracToMs(frac, col), col, ev.snap_minutes);
    },
    [columns, ev.snap_minutes],
  );

  const onMove = useCallback(
    (clientY: number) => {
      const d = dragRef.current;
      if (!d) return;
      const col = columns[d.colIndex];
      const ms = pointerMsFor(d, clientY);

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
          // move: keep length, clamp inside the column
          const len = b.endMs - b.startMs;
          let start = ms - d.anchorMs;
          start = Math.min(Math.max(start, col.startMs), col.endMs - len);
          return { ...b, startMs: start, endMs: start + len };
        }),
      );
    },
    [columns, dragRef, minLenMs, pointerMsFor, setMyBlocks],
  );

  const onUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind === "create") {
      // Drop blocks that are too small to be meaningful (a plain click).
      setMyBlocks((prev) =>
        prev.filter((b) => b.id !== d.blockId || b.endMs - b.startMs >= minLenMs),
      );
    }
  }, [dragRef, minLenMs, setMyBlocks]);

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
    const start = snapMs(
      fracToMs((e.clientY - rect.top) / rect.height, col),
      col,
      ev.snap_minutes,
    );
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `tmp-${Date.now()}-${Math.round(start)}`;
    dragRef.current = {
      kind: "create",
      colIndex,
      rectTop: rect.top,
      rectH: rect.height,
      blockId: id,
      anchorMs: start,
    };
    setMyBlocks((prev) => [...prev, { id, colIndex, startMs: start, endMs: start }]);
    e.preventDefault();
  }

  function beginMove(block: EditBlock, e: React.PointerEvent) {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = colRectFrom(e.currentTarget);
    if (!rect) return;
    const col = columns[block.colIndex];
    const ms = snapMs(
      fracToMs((e.clientY - rect.top) / rect.height, col),
      col,
      ev.snap_minutes,
    );
    dragRef.current = {
      kind: "move",
      colIndex: block.colIndex,
      rectTop: rect.top,
      rectH: rect.height,
      blockId: block.id,
      anchorMs: ms - block.startMs,
    };
  }

  function beginResize(
    block: EditBlock,
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
      colIndex: block.colIndex,
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
        {/* Header row */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <div className="w-14 shrink-0" />
          {columns.map((col, i) => {
            const { weekday, day } = columnLabel(col, displayTz);
            return (
              <div
                key={i}
                className="flex-1 border-l border-slate-200 py-2 text-center"
              >
                <div className="text-xs font-medium uppercase text-slate-400">
                  {weekday}
                </div>
                <div className="text-sm font-semibold text-slate-700">{day}</div>
              </div>
            );
          })}
        </div>

        {/* Body row */}
        <div className="flex">
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
              {/* Hour gridlines */}
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute inset-x-0 border-t border-slate-100"
                  style={{ top: t.frac * H }}
                />
              ))}

              {/* Overlap (read-only) */}
              {overlap.map((seg, i) => {
                const clip = clipToColumn(seg.start, seg.end, col);
                if (!clip) return null;
                const top = clip.topFrac * H;
                const height = (clip.bottomFrac - clip.topFrac) * H;
                return (
                  <div
                    key={`o-${i}`}
                    className="pointer-events-none absolute inset-x-0.5 overflow-hidden rounded-sm"
                    style={{ top, height, background: segColor(seg.count, maxCount) }}
                  >
                    {height > 16 && (
                      <span className="absolute right-1 top-0.5 text-[10px] font-semibold text-emerald-900/70">
                        {seg.count}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* My editable blocks */}
              {myBlocks
                .filter((b) => b.colIndex === ci)
                .map((b) => {
                  const top = ((b.startMs - col.startMs) / (col.endMs - col.startMs)) * H;
                  const height = ((b.endMs - b.startMs) / (col.endMs - col.startMs)) * H;
                  return (
                    <div
                      key={b.id}
                      onPointerDown={(e) => beginMove(b, e)}
                      className="absolute inset-x-0.5 rounded-md border border-indigo-500 bg-indigo-500/30 text-[10px] text-indigo-900 shadow-sm"
                      style={{ top, height, cursor: editable ? "move" : "default" }}
                    >
                      {editable && (
                        <>
                          <div
                            onPointerDown={(e) => beginResize(b, "resize-top", e)}
                            className="absolute inset-x-0 top-0 h-2 cursor-ns-resize"
                          />
                          <div
                            onPointerDown={(e) => beginResize(b, "resize-bottom", e)}
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
