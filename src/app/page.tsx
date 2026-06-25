import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const steps = [
    {
      title: "Create a request",
      body: "Pick the dates and the daily window you'd consider, and set a target meeting length.",
    },
    {
      title: "Drag your availability",
      body: "Block out when you're free on a weekly calendar — just like dragging an event in Google Calendar.",
    },
    {
      title: "Share the link",
      body: "Send it to anyone. They add their availability with just a name — no account needed.",
    },
    {
      title: "See what works",
      body: "GroupSchedule highlights the overlapping windows long enough to fit your meeting, ranked best-first.",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 text-center sm:py-24">
        <p className="mb-3 text-sm font-medium text-indigo-600">
          Group meeting scheduling, the easy way
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Find a time that works for everyone.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
          Drag your availability onto a weekly calendar, share a link, and let
          GroupSchedule find the overlapping windows that fit your meeting —
          across time zones.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href={user ? "/events/new" : "/signup"}
            className="rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            {user ? "Create a scheduling request" : "Get started — it's free"}
          </Link>
          {user ? (
            <Link
              href="/dashboard"
              className="rounded-lg border border-slate-300 bg-white px-5 py-3 font-medium text-slate-700 hover:bg-slate-50"
            >
              My requests
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-lg border border-slate-300 bg-white px-5 py-3 font-medium text-slate-700 hover:bg-slate-50"
            >
              Log in
            </Link>
          )}
        </div>
      </section>

      <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div
            key={s.title}
            className="rounded-xl border border-slate-200 bg-white p-5"
          >
            <div className="mb-3 grid h-8 w-8 place-items-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-600">
              {i + 1}
            </div>
            <h3 className="font-semibold text-slate-900">{s.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{s.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
