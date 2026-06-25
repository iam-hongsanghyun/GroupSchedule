"use client";

import type { ParticipantResponse } from "@/lib/types";

interface Props {
  responses: ParticipantResponse[];
  myParticipantId: string | null;
  colorById?: Record<string, string>;
  onJump?: (r: ParticipantResponse) => void;
}

export function ParticipantList({
  responses,
  myParticipantId,
  colorById = {},
  onJump,
}: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">
        Responders{" "}
        <span className="font-normal text-slate-400">({responses.length})</span>
      </h2>
      {responses.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No one has responded yet.</p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-slate-400">
            Tap a responder to jump to their week.
          </p>
          <ul className="mt-2 space-y-1">
            {responses.map((r) => {
              const isMe = r.participant_id === myParticipantId;
              const rgb = colorById[r.participant_id] ?? "99,102,241";
              const hasBlocks = r.blocks.length > 0;
              return (
                <li key={r.participant_id}>
                  <button
                    type="button"
                    onClick={() => onJump?.(r)}
                    disabled={!hasBlocks}
                    title={hasBlocks ? "Jump to their week" : "No availability yet"}
                    className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-sm enabled:hover:bg-slate-50 disabled:cursor-default"
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
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
