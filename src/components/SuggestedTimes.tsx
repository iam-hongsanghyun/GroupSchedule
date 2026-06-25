"use client";

import type { SuggestedWindow } from "@/lib/scheduling";
import { formatRange, formatTime } from "@/lib/time";

interface Props {
  windows: SuggestedWindow[];
  displayTz: string;
  nameById: Record<string, string>;
}

export function SuggestedTimes({ windows, displayTz, nameById }: Props) {
  if (windows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Suggested times</h2>
        <p className="mt-2 text-sm text-slate-500">
          No overlapping window long enough yet. Add availability or invite more
          people.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">Suggested times</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Windows long enough to fit the meeting, best first.
      </p>
      <ol className="mt-3 space-y-2">
        {windows.slice(0, 8).map((w, i) => {
          const everyone = w.count === w.total;
          const names = w.participantIds
            .map((id) => nameById[id])
            .filter(Boolean)
            .join(", ");
          return (
            <li
              key={`${w.start}-${i}`}
              className="rounded-lg border border-slate-200 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-900">
                  {formatRange(w.start, w.end, displayTz)}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    everyone
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {w.count}/{w.total}
                </span>
              </div>
              {w.freeUntil > w.end && (
                <p className="mt-0.5 text-xs text-slate-500">
                  free until {formatTime(w.freeUntil, displayTz)}
                </p>
              )}
              {names && (
                <p className="mt-1 truncate text-xs text-slate-400" title={names}>
                  {names}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
