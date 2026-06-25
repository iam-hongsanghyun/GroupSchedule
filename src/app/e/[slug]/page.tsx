import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SchedulerClient } from "./SchedulerClient";
import type { EventConfig, ParticipantResponse } from "@/lib/types";

export default async function SharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: ev } = await supabase.rpc("get_event_public", { p_slug: slug });
  if (!ev) notFound();
  const event = ev as EventConfig;

  const { data: responsesData } = await supabase.rpc("get_event_responses", {
    p_slug: slug,
  });
  const responses = (responsesData ?? []) as ParticipantResponse[];

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let currentUserName: string | null = null;
  let myParticipantId: string | null = null;
  let isOwner = false;

  if (user) {
    currentUserName =
      (user.user_metadata?.display_name as string | undefined) ??
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email?.split("@")[0] ??
      null;

    // RLS returns the row only to the owner, so a hit means this user owns it.
    const { data: ownerRow } = await supabase
      .from("events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();
    isOwner = !!ownerRow;

    const { data: mine } = await supabase
      .from("participants")
      .select("id")
      .eq("event_id", event.id)
      .eq("user_id", user.id)
      .maybeSingle();
    myParticipantId = mine?.id ?? null;
  }

  return (
    <SchedulerClient
      ev={event}
      initialResponses={responses}
      currentUserName={currentUserName}
      isLoggedIn={!!user}
      isOwner={isOwner}
      myParticipantId={myParticipantId}
    />
  );
}
