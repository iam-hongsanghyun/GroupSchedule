"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/client";
import { WeekGrid, type EditBlock } from "@/components/WeekGrid";
import { SuggestedTimes } from "@/components/SuggestedTimes";
import { ParticipantList } from "@/components/ParticipantList";
import { CopyButton } from "@/components/CopyButton";
import { computeOverlap, suggestWindows, type SuggestedWindow } from "@/lib/scheduling";
import {
  weekColumns,
  startOfWeekISO,
  addDaysISO,
  weekLabel,
  localTimezone,
  formatRange,
} from "@/lib/time";
import type { Block, EventConfig, ParticipantResponse } from "@/lib/types";

interface Props {
  ev: EventConfig;
  initialResponses: ParticipantResponse[];
  currentUserName: string | null;
  isLoggedIn: boolean;
  isOwner: boolean;
  myParticipantId: string | null;
}

interface StoredResponse {
  participant_id: string;
  edit_token: string;
  name: string;
  email?: string;
}

function newId(seed: number): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `b-${seed}`;
}

function editableToBlocks(blocks: EditBlock[]): Block[] {
  return blocks.map((b) => ({
    start: new Date(b.startMs).toISOString(),
    end: new Date(b.endMs).toISOString(),
  }));
}

function blocksToEditable(blocks: Block[]): EditBlock[] {
  return blocks
    .map((b, i): EditBlock => ({
      id: newId(i),
      startMs: new Date(b.start).getTime(),
      endMs: new Date(b.end).getTime(),
    }))
    .filter((b) => b.endMs > b.startMs);
}

export function SchedulerClient({
  ev,
  initialResponses,
  currentUserName,
  isLoggedIn,
  isOwner,
  myParticipantId,
}: Props) {
  const supabase = useMemo(() => createClient(), []);

  const [responses, setResponses] = useState<ParticipantResponse[]>(initialResponses);
  const [myPid, setMyPid] = useState<string | null>(myParticipantId);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [name, setName] = useState(currentUserName ?? "");
  const [started, setStarted] = useState(isLoggedIn);
  const [myBlocks, setMyBlocks] = useState<EditBlock[]>([]);
  const [displayTz, setDisplayTz] = useState(ev.organizer_timezone);
  const [weekStart, setWeekStart] = useState(() => startOfWeekISO(ev.start_date));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState<{ start: number; end: number }[]>([]);
  const [googleStatus, setGoogleStatus] = useState<
    "unknown" | "connected" | "disconnected" | "loading"
  >("unknown");
  const [finalized, setFinalized] = useState<{ start: number; end: number } | null>(
    ev.finalized_start && ev.finalized_end
      ? { start: Date.parse(ev.finalized_start), end: Date.parse(ev.finalized_end) }
      : null,
  );
  const [meetUrl, setMeetUrl] = useState<string | null>(ev.meet_url);
  const [scheduling, setScheduling] = useState(false);
  const [email, setEmail] = useState("");

  const localTz = useMemo(() => localTimezone(), []);
  const columns = useMemo(() => weekColumns(weekStart, ev), [weekStart, ev]);

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
          if (stored.email) setEmail(stored.email);
          setStarted(true);
        }
      } catch {
        /* ignore malformed storage */
      }
    }

    if (pid) {
      const mine = initialResponses.find((r) => r.participant_id === pid);
      if (mine) {
        setMyBlocks(blocksToEditable(mine.blocks));
        if (mine.display_name && !currentUserName) setName(mine.display_name);
        setStarted(true);
        // Open on the week of the first block they marked.
        if (mine.blocks[0]) {
          const first = DateTime.fromISO(mine.blocks[0].start, {
            zone: ev.organizer_timezone,
          }).toISODate();
          if (first) setWeekStart(startOfWeekISO(first));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meActive = isLoggedIn || started || !!myPid;
  const editable = meActive && name.trim().length > 0;

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
    const { data } = await supabase.rpc("get_event_responses", { p_slug: ev.share_slug });
    setResponses((data ?? []) as ParticipantResponse[]);
  }, [supabase, ev.share_slug]);

  // Fetch the signed-in user's Google free/busy for the visible week, using the
  // provider token Supabase stores after a Google OAuth sign-in.
  const loadGoogleBusy = useCallback(async () => {
    if (!columns.length || !isLoggedIn) {
      setGoogleStatus("disconnected");
      return;
    }
    try {
      const timeMin = new Date(columns[0].startMs).toISOString();
      const timeMax = new Date(columns[columns.length - 1].endMs).toISOString();
      const res = await fetch(
        `/api/calendar?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
      );
      const json = await res.json();
      if (!json.connected) {
        setGoogleStatus("disconnected");
        setGoogleBusy([]);
        return;
      }
      const busy = (json.busy ?? []) as { start: string; end: string }[];
      setGoogleBusy(busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })));
      setGoogleStatus("connected");
    } catch {
      setGoogleStatus("disconnected");
    }
  }, [columns, isLoggedIn]);

  useEffect(() => {
    loadGoogleBusy();
  }, [loadGoogleBusy]);

  async function connectGoogleCalendar() {
    setGoogleStatus("loading");
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes:
          "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
        redirectTo: `${window.location.origin}/auth/callback?next=/e/${ev.share_slug}`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (oauthError) setGoogleStatus("disconnected");
  }

  async function pickTime(w: SuggestedWindow) {
    setFinalized({ start: w.start, end: w.end });
    setMeetUrl(null); // time changed → any prior Meet link is stale
    await supabase
      .from("events")
      .update({
        finalized_start: new Date(w.start).toISOString(),
        finalized_end: new Date(w.end).toISOString(),
        meet_url: null,
        gcal_event_id: null,
      })
      .eq("id", ev.id);
  }

  async function clearFinalized() {
    setFinalized(null);
    setMeetUrl(null);
    await supabase
      .from("events")
      .update({
        finalized_start: null,
        finalized_end: null,
        meet_url: null,
        gcal_event_id: null,
      })
      .eq("id", ev.id);
  }

  async function createMeet() {
    setScheduling(true);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: ev.share_slug }),
      });
      const json = await res.json();
      if (res.ok && json.meet_url) {
        setMeetUrl(json.meet_url);
      } else if (json.error === "connect_calendar") {
        await connectGoogleCalendar();
      } else {
        setError(
          json.error === "google_error"
            ? "Google couldn't create the event — make sure you granted calendar access."
            : json.error ?? "Could not create the meeting.",
        );
      }
    } finally {
      setScheduling(false);
    }
  }

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
      p_email: email.trim() || null,
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
            email: email.trim() || undefined,
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

  const durationLabel =
    ev.meeting_duration_minutes >= 60
      ? `${ev.meeting_duration_minutes / 60}h`
      : `${ev.meeting_duration_minutes}m`;
  const showTzToggle = localTz !== ev.organizer_timezone;
  const navBtn =
    "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 hover:bg-slate-50";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">{ev.title}</h1>
        {ev.description && <p className="mt-1 text-slate-600">{ev.description}</p>}
        <p className="mt-1 text-sm text-slate-500">
          Target {durationLabel} meeting · drag the calendar to mark when you&apos;re free
        </p>
      </header>

      {finalized && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <p className="text-sm font-semibold text-indigo-900">
            ★ Scheduled: {formatRange(finalized.start, finalized.end, displayTz)}
            {!isOwner && (
              <span className="ml-2 font-normal text-indigo-700">
                (set by the organizer)
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {meetUrl ? (
              <a
                href={meetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Join Google Meet
              </a>
            ) : (
              isOwner && (
                <button
                  type="button"
                  onClick={createMeet}
                  disabled={scheduling}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {scheduling ? "Creating…" : "Create Google Meet & send invites"}
                </button>
              )
            )}
            {isOwner && (
              <button
                type="button"
                onClick={clearFinalized}
                className="rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          {/* Week navigation toolbar */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setWeekStart(addDaysISO(weekStart, -28))} className={navBtn} aria-label="Previous month">
                «
              </button>
              <button type="button" onClick={() => setWeekStart(addDaysISO(weekStart, -7))} className={navBtn} aria-label="Previous week">
                ‹
              </button>
              <span className="min-w-[150px] text-center text-sm font-semibold text-slate-800">
                {weekLabel(weekStart)}
              </span>
              <button type="button" onClick={() => setWeekStart(addDaysISO(weekStart, 7))} className={navBtn} aria-label="Next week">
                ›
              </button>
              <button type="button" onClick={() => setWeekStart(addDaysISO(weekStart, 28))} className={navBtn} aria-label="Next month">
                »
              </button>
              <button
                type="button"
                onClick={() =>
                  setWeekStart(startOfWeekISO(DateTime.now().toISODate()!))
                }
                className="ml-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Today
              </button>
            </div>

            {showTzToggle && (
              <div className="flex rounded-lg border border-slate-300 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setDisplayTz(localTz)}
                  className={`rounded-md px-2.5 py-1 ${displayTz === localTz ? "bg-indigo-600 text-white" : "text-slate-600"}`}
                >
                  My time
                </button>
                <button
                  type="button"
                  onClick={() => setDisplayTz(ev.organizer_timezone)}
                  className={`rounded-md px-2.5 py-1 ${displayTz === ev.organizer_timezone ? "bg-indigo-600 text-white" : "text-slate-600"}`}
                >
                  Organizer
                </button>
              </div>
            )}
          </div>

          <div className="mb-2 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-indigo-500/40 ring-1 ring-indigo-500" />
              Your availability
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-emerald-500/50" />
              Everyone&apos;s overlap
            </span>
            {googleStatus === "connected" && (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{
                    backgroundColor: "rgba(100,116,139,0.12)",
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(100,116,139,0.4) 0, rgba(100,116,139,0.4) 1px, transparent 1px, transparent 4px)",
                  }}
                />
                Your busy times
              </span>
            )}
          </div>

          <WeekGrid
            ev={ev}
            columns={columns}
            displayTz={displayTz}
            refDateISO={weekStart}
            overlap={overlap}
            maxCount={effective.length || 1}
            myBlocks={myBlocks}
            setMyBlocks={setMyBlocks}
            editable={editable}
            busy={googleBusy}
            finalized={finalized}
          />
          <p className="mt-2 text-xs text-slate-400">
            Times in <span className="font-medium">{displayTz}</span>. Scroll the grid
            for other hours; use ‹ › to change weeks.
            {editable
              ? " Drag to add availability; drag edges to resize, the middle to move, × to delete."
              : ""}
          </p>
        </div>

        <aside className="space-y-4">
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
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="Email (optional — for a calendar invite)"
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

          {isLoggedIn && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Your Google Calendar</h2>
            {googleStatus === "connected" ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm text-emerald-600">
                  ✓ Showing your busy times on the grid.
                </p>
                <p className="text-xs text-slate-500">
                  {googleBusy.length} event{googleBusy.length === 1 ? "" : "s"} this week ·{" "}
                  <button
                    type="button"
                    onClick={loadGoogleBusy}
                    className="underline hover:text-slate-700"
                  >
                    Refresh
                  </button>
                </p>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-slate-500">
                  See your existing events here so you can mark availability around them.
                </p>
                <button
                  type="button"
                  onClick={connectGoogleCalendar}
                  disabled={googleStatus === "loading"}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
                    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z" />
                    <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.06l3.01-2.34z" />
                    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
                  </svg>
                  {googleStatus === "loading" ? "Connecting…" : "Connect Google Calendar"}
                </button>
              </div>
            )}
          </div>
          )}

          <SuggestedTimes
            windows={suggestions}
            displayTz={displayTz}
            nameById={nameById}
            canPick={isOwner}
            selectedStart={finalized?.start ?? null}
            onPick={pickTime}
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
