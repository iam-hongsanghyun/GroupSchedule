"use server";

import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";

export async function createEvent(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const snap_minutes = Number(formData.get("snap_minutes") ?? 15);
  const meeting_duration_minutes = Number(formData.get("duration") ?? 60);
  const organizer_timezone = String(formData.get("timezone") ?? "UTC");

  if (!title) {
    redirect(`/events/new?error=${encodeURIComponent("Please give your request a title.")}`);
  }

  // No fixed date range or daily window: the calendar is freely navigable and
  // spans the full day. We anchor the initial view to today in the organizer's
  // timezone; availability can be added on any week.
  const today =
    DateTime.now().setZone(organizer_timezone).toISODate() ??
    DateTime.now().toISODate()!;

  const { data, error } = await supabase
    .from("events")
    .insert({
      owner_id: user.id,
      title,
      description,
      start_date: today,
      end_date: today,
      day_start_minute: 0,
      day_end_minute: 1440,
      snap_minutes,
      meeting_duration_minutes,
      organizer_timezone,
    })
    .select("share_slug")
    .single();

  if (error || !data) {
    redirect(
      `/events/new?error=${encodeURIComponent(error?.message ?? "Could not create the request.")}`,
    );
  }

  redirect(`/e/${data!.share_slug}`);
}
