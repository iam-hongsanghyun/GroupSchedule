/** A scheduling request, as returned by the get_event_public RPC. */
export interface EventConfig {
  id: string;
  share_slug: string;
  title: string;
  description: string | null;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string; // inclusive, 'YYYY-MM-DD'
  day_start_minute: number; // minutes from midnight (organizer tz)
  day_end_minute: number;
  snap_minutes: number;
  meeting_duration_minutes: number; // guideline target
  organizer_timezone: string; // IANA
  finalized_start: string | null;
  finalized_end: string | null;
  meet_url: string | null;
  gcal_event_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A stored availability window, in UTC ISO instants. */
export interface Block {
  start: string;
  end: string;
}

/** One responder's full set of availability blocks. */
export interface ParticipantResponse {
  participant_id: string;
  display_name: string;
  timezone: string;
  blocks: Block[];
}

/** Event row shown in the organizer's dashboard. */
export interface EventSummary {
  id: string;
  share_slug: string;
  title: string;
  start_date: string;
  end_date: string;
  created_at: string;
}
