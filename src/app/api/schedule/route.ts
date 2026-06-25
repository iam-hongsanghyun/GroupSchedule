import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleAccessToken } from "@/lib/google";

/**
 * Creates a Google Calendar event with a Meet link for the finalized time on
 * the organizer's calendar, invites any responders who left an email, and
 * stores the Meet URL on the event. Owner-only (enforced by RLS).
 */
export async function POST(request: Request) {
  const { slug } = (await request.json()) as { slug?: string };
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // RLS returns the row only to the owner.
  const { data: ev } = await supabase
    .from("events")
    .select("*")
    .eq("share_slug", slug)
    .maybeSingle();
  if (!ev) {
    return NextResponse.json({ error: "Not found or not your request" }, { status: 403 });
  }
  if (!ev.finalized_start || !ev.finalized_end) {
    return NextResponse.json({ error: "Pick a meeting time first" }, { status: 400 });
  }

  const { data: cred } = await supabase
    .from("google_credentials")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!cred) return NextResponse.json({ error: "connect_calendar" }, { status: 409 });

  const token = await googleAccessToken(cred.refresh_token);
  if (!token) return NextResponse.json({ error: "connect_calendar" }, { status: 409 });

  const { data: parts } = await supabase
    .from("participants")
    .select("email")
    .eq("event_id", ev.id);
  const attendees = (parts ?? [])
    .map((p) => p.email as string | null)
    .filter((e): e is string => !!e)
    .map((email) => ({ email }));

  // If a meeting link is already set (e.g. a pasted Zoom/Teams URL), invite
  // with that link; otherwise generate a Google Meet for the event.
  const existingLink: string | null = ev.meet_url ?? null;
  const requestId = `gs-${ev.id}-${Date.parse(ev.finalized_start)}`
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 64);

  const description = [ev.description, existingLink ? `Join: ${existingLink}` : null]
    .filter(Boolean)
    .join("\n\n");

  const body: Record<string, unknown> = {
    summary: ev.title,
    description: description || undefined,
    start: { dateTime: new Date(ev.finalized_start).toISOString(), timeZone: "UTC" },
    end: { dateTime: new Date(ev.finalized_end).toISOString(), timeZone: "UTC" },
    attendees,
  };
  if (existingLink) {
    body.location = existingLink;
  } else {
    body.conferenceData = {
      createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }

  const endpoint = existingLink
    ? "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all"
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    return NextResponse.json({ error: "google_error", detail }, { status: 502 });
  }

  const created = await res.json();
  const meetUrl: string | null =
    existingLink ??
    created.hangoutLink ??
    created.conferenceData?.entryPoints?.find(
      (e: { entryPointType?: string; uri?: string }) => e.entryPointType === "video",
    )?.uri ??
    null;

  await supabase
    .from("events")
    .update({ meet_url: meetUrl, gcal_event_id: created.id })
    .eq("id", ev.id);

  return NextResponse.json({
    meet_url: meetUrl,
    htmlLink: created.htmlLink ?? null,
    invited: attendees.length,
  });
}
