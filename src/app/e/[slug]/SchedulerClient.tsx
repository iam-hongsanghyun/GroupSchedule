"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/client";
import { WeekGrid, type EditBlock } from "@/components/WeekGrid";
import { SuggestedTimes } from "@/components/SuggestedTimes";
import { ParticipantList } from "@/components/ParticipantList";
import { CopyButton } from "@/components/CopyButton";
import { computeOverlap, suggestWindows } from "@/lib/scheduling";
import {
  type GridColumn,
  gridColumns,
  localTimezone,
  minuteLabel,
} from "@/lib/time";
import type { Block, EventConfig, ParticipantResponse } from "@/lib/types";

interface Props {
  ev: EventConfig;
  initialResponses: ParticipantResponse[];
  currentUserName: string | null;
  isLoggedIn: boolean;
  myParticipantId: string | null;
}

interface StoredResponse {
  participant_id: string;
  edit_token: string;
  name: string;
}

function editableToBlocks(blocks: EditBlock[]): Block[] {
  return blocks.map((b) => ({
    start: new Date(b.startMs).toISOString(),
    end: new Date(b.endMs).toISOString(),
  }));
}

function blocksToEditable(columns: GridColumn[], blocks: Block[]): EditBlock[] {
  return blocks
    .map((b): EditBlock | null => {
      const s = new Date(b.start).getTime();
      const e = new Date(b.end).getTime();
      let ci = columns.findIndex((c) => s >= c.startMs && s < c.endMs);
      if (ci < 0) ci = columns.findIndex((c) => e > c.startMs && s < c.endMs);
      if (ci < 0) return null;
      const col = columns[ci];
      const startMs = Math.max(s, col.startMs);
      const endMs = Math.min(e, col.endMs);
      if (endMs <= startMs) return null;
      return {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `b-${ci}-${startMs}`,
        colIndex: ci,
        startMs,
        endMs,
      };
    })
    .filter((b): b is EditBlock => b !== null);
}

export function SchedulerClient({
  ev,
  initialResponses,
  currentUserName,
  isLoggedIn,
  myParticipantId,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const columns = useMemo(() => gridColumns(ev), [ev]);

  const [responses, setResponses] = useState<ParticipantResponse[]>(initialResponses);
  const [myPid, setMyPid] = useState<string | null>(myParticipantId);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [name, setName] = useState(currentUserName ?? "");
  const [started, setStarted] = useState(isLoggedIn);
  const [myBlocks, setMyBlocks] = useState<EditBlock[]>([]);
  const [displayTz, setDisplayTz] = useState(ev.organizer_timezone);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const localTz = useMemo(() => localTimezone(), []);

  // Resolve "my" response on mount: from the server (logged in) or localStorage (anon).
  useEffect(() => {
    setDisplayTz(localTimezone());

    let pid = myParticipantId;
    if (!isLoggedIn) {
      try {
        const raw = localStorage.getItem(`gs_resp_${ev.share_slug}`);
        if (raw) {
          const stored = JSON.parse(raw) as StoredResponse;
          pid = stored.participant_id;
          setMyPid(stored.participant_id);
          setEditToken(stored.edit_token);
          if (stored.name) setName(stored.name);
          setStarted(true);
        }
      } catch {
        /* ignore malformed storage */
      }
    }

    if (pid) {
      const mine = initialResponses.find((r) => r.participant_id === pid);
      if (mine) {
        setMyBlocks(blocksToEditable(columns, mine.blocks));
        if (mine.display_name && !currentUserName) setName(mine.display_name);
        setStarted(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meActive = isLoggedIn || started || !!myPid;
  const editable = meActive && name.trim().length > 0;

  // Effective responses: replace my saved entry with my live edits.
  const effective = useMemo<ParticipantResponse[]>(() => {
    const others = responses.filter((r) => r.participant_id !== (myPid ?? "__none__"));
    if (!meActive) return responses;
    const mine: ParticipantResponse = {
      participant_id: myPid ?? "me",
      display_name: name.trim() || "You",
      timezone: displayTz,
      blocks: editableToBlocks(myBlocks),
    };
    return [...others, mine];
  }, [responses, myPid, meActive, name, displayTz, myBlocks]);

  const overlap = useMemo(() => computeOverlap(effective), [effective]);
  const suggestions = useMemo(
    () => suggestWindows(effective, ev.meeting_duration_minutes, effective.length),
    [effective, ev.meeting_duration_minutes],
  );
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of effective) m[r.participant_id] = r.display_name;
    return m;
  }, [effective]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc("get_event_responses", {
      p_slug: ev.share_slug,
    });
    setResponses((data ?? []) as ParticipantResponse[]);
  }, [supabase, ev.share_slug]);

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc("upsert_my_availability", {
      p_slug: ev.share_slug,
      p_display_name: name.trim(),
      p_timezone: displayTz,
      p_blocks: editableToBlocks(myBlocks),
      p_edit_token: isLoggedIn ? null : editToken,
    });
    if (rpcError || !data) {
      setError(rpcError?.message ?? "Could not save your availability.");
      setSaving(false);
      return;
    }
    const res = data as { participant_id: string; edit_token: string };
    setMyPid(res.participant_id);
    if (!isLoggedIn) {
      setEditToken(res.edit_token);
      try {
        localStorage.setItem(
          `gs_resp_${ev.share_slug}`,
          JSON.stringify({
            participant_id: res.participant_id,
            edit_token: res.edit_token,
            name: name.trim(),
          } satisfies StoredResponse),
        );
      } catch {
        /* ignore */
      }
    }
    await refresh();
    setSaving(false);
    setSavedAt(Date.now());
  }

  const dateRangeLabel = `${DateTime.fromISO(ev.start_date).toFormat(
    "LLL d",
  )} – ${DateTime.fromISO(ev.end_date).toFormat("LLL d, yyyy")}`;

  const showTzToggle = localTz !== ev.organizer_timezone;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">{ev.title}</h1>
        {ev.description && (
          <p className="mt-1 text-slate-600">{ev.description}</p>
        )}
        <p className="mt-1 text-sm text-slate-500">
          {dateRangeLabel} · {minuteLabel(ev.day_start_minute)}–
          {minuteLabel(ev.day_end_minute)} · target{" "}
          {ev.meeting_duration_minutes >= 60
            ? `${ev.meeting_duration_minutes / 60}h`
            : `${ev.meeting_duration_minutes}m`}{" "}
          meeting
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-indigo-500/40 ring-1 ring-indigo-500" />
                Your availability
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-emerald-500/50" />
                Everyone&apos;s overlap
              </span>
            </div>
            {showTzToggle && (
              <div className="flex rounded-lg border border-slate-300 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setDisplayTz(localTz)}
                  className={`rounded-md px-2.5 py-1 ${
                    displayTz === localTz
                      ? "bg-indigo-600 text-white"
                      : "text-slate-600"
                  }`}
                >
                  My time
                </button>
                <button
                  type="button"
                  onClick={() => setDisplayTz(ev.organizer_timezone)}
                  className={`rounded-md px-2.5 py-1 ${
                    displayTz === ev.organizer_timezone
                      ? "bg-indigo-600 text-white"
                      : "text-slate-600"
                  }`}
                >
                  Organizer
                </button>
              </div>
            )}
          </div>

          <WeekGrid
            ev={ev}
            columns={columns}
            displayTz={displayTz}
            overlap={overlap}
            maxCount={effective.length || 1}
            myBlocks={myBlocks}
            setMyBlocks={setMyBlocks}
            editable={editable}
          />
          <p className="mt-2 text-xs text-slate-400">
            Times shown in <span className="font-medium">{displayTz}</span>.
            {editable
              ? " Drag on the calendar to mark when you're free; drag edges to resize, the middle to move, × to delete."
              : ""}
          </p>
        </div>

        <aside className="space-y-4">
          {/* Availability editor / name gate */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Your availability</h2>
            {!meActive ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-slate-600">
                  Add your name to start marking when you&apos;re free.
                </p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="button"
                  onClick={() => setStarted(true)}
                  disabled={!name.trim()}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  Start
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>
                    {myBlocks.length} block{myBlocks.length === 1 ? "" : "s"} marked
                  </span>
                  {myBlocks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMyBlocks(() => [])}
                      className="text-slate-500 hover:text-red-600"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : myPid ? "Update my availability" : "Save my availability"}
                </button>
                {savedAt && !saving && (
                  <p className="text-center text-xs text-emerald-600">Saved ✓</p>
                )}
              </div>
            )}
          </div>

          <SuggestedTimes
            windows={suggestions}
            displayTz={displayTz}
            nameById={nameById}
          />

          <ParticipantList responses={responses} myParticipantId={myPid} />

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Invite others</h2>
            <p className="mt-1 text-xs text-slate-500">
              Share this link — anyone can add availability with just a name.
            </p>
            <div className="mt-3">
              <CopyButton slug={ev.share_slug} label="Copy share link" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
