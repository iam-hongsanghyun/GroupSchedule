import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { CopyButton } from "@/components/CopyButton";
import { DeleteEventButton } from "@/components/DeleteEventButton";
import type { EventSummary } from "@/lib/types";

function dateRange(start: string, end: string): string {
  const s = DateTime.fromISO(start);
  const e = DateTime.fromISO(end);
  if (s.hasSame(e, "day")) return s.toFormat("LLL d, yyyy");
  if (s.hasSame(e, "year")) {
    return `${s.toFormat("LLL d")} – ${e.toFormat("LLL d, yyyy")}`;
  }
  return `${s.toFormat("LLL d, yyyy")} – ${e.toFormat("LLL d, yyyy")}`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: events } = await supabase
    .from("events")
    .select("id, share_slug, title, start_date, end_date, created_at")
    .order("created_at", { ascending: false });

  const list = (events ?? []) as EventSummary[];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Your requests</h1>
        <Link
          href="/events/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + New request
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">You haven&apos;t created any requests yet.</p>
          <Link
            href="/events/new"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Create your first request
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {list.map((ev) => (
            <li
              key={ev.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <Link
                  href={`/e/${ev.share_slug}`}
                  className="font-semibold text-slate-900 hover:text-indigo-600"
                >
                  {ev.title}
                </Link>
                <p className="text-sm text-slate-500">
                  {dateRange(ev.start_date, ev.end_date)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton slug={ev.share_slug} />
                <Link
                  href={`/e/${ev.share_slug}`}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Open
                </Link>
                <DeleteEventButton id={ev.id} title={ev.title} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
