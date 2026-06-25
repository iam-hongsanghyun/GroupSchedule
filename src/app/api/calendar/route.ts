import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleAccessToken } from "@/lib/google";

/** Returns the signed-in user's Google free/busy for a time range (their own
 *  primary calendar only). Uses the server-stored refresh token. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timeMin = searchParams.get("timeMin");
  const timeMax = searchParams.get("timeMax");
  if (!timeMin || !timeMax) {
    return NextResponse.json({ connected: false, busy: [] });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false, busy: [] });

  const { data: cred } = await supabase
    .from("google_credentials")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!cred) return NextResponse.json({ connected: false, busy: [] });

  const token = await googleAccessToken(cred.refresh_token);
  if (!token) return NextResponse.json({ connected: false, busy: [] });

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }),
  });
  if (!res.ok) return NextResponse.json({ connected: false, busy: [] });

  const json = await res.json();
  const busy = (json?.calendars?.primary?.busy ?? []) as { start: string; end: string }[];
  return NextResponse.json({ connected: true, busy });
}
