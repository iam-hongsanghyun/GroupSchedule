"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

export async function createEvent(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const start_date = String(formData.get("start_date") ?? "");
  const end_date = String(formData.get("end_date") ?? "");
  const day_start_minute = hhmmToMinutes(String(formData.get("day_start") ?? "09:00"));
  const day_end_minute = hhmmToMinutes(String(formData.get("day_end") ?? "18:00"));
  const snap_minutes = Number(formData.get("snap_minutes") ?? 15);
  const meeting_duration_minutes = Number(formData.get("duration") ?? 60);
  const organizer_timezone = String(formData.get("timezone") ?? "UTC");

  const fail = (msg: string) =>
    redirect(`/events/new?error=${encodeURIComponent(msg)}`);

  if (!title) fail("Please give your request a title.");
  if (!start_date || !end_date) fail("Please choose a date range.");
  if (end_date < start_date) fail("End date must be on or after the start date.");
  if (day_end_minute <= day_start_minute)
    fail("The daily end time must be after the start time.");

  const { data, error } = await supabase
    .from("events")
    .insert({
      owner_id: user.id,
      title,
      description,
      start_date,
      end_date,
      day_start_minute,
      day_end_minute,
      snap_minutes,
      meeting_duration_minutes,
      organizer_timezone,
    })
    .select("share_slug")
    .single();

  if (error || !data) {
    fail(error?.message ?? "Could not create the request.");
  }

  redirect(`/e/${data!.share_slug}`);
}
