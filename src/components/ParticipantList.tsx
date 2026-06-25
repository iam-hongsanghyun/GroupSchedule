"use client";

import type { ParticipantResponse } from "@/lib/types";

interface Props {
  responses: ParticipantResponse[];
  myParticipantId: string | null;
  colorById?: Record<string, string>;
}

export function ParticipantList({ responses, myParticipantId, colorById = {} }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">
        Responders{" "}
        <span className="font-normal text-slate-400">({responses.length})</span>
      </h2>
      {responses.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No one has responded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {responses.map((r) => {
            const isMe = r.participant_id === myParticipantId;
            const rgb = colorById[r.participant_id] ?? "99,102,241";
            return (
              <li
                key={r.participant_id}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: `rgb(${rgb})` }}
                  />
                  <span className="font-medium text-slate-700">
                    {r.display_name}
                    {isMe && (
                      <span className="ml-1 text-xs text-indigo-500">(you)</span>
                    )}
                  </span>
                </span>
                <span className="text-xs text-slate-400">
                  {r.blocks.length} block{r.blocks.length === 1 ? "" : "s"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
