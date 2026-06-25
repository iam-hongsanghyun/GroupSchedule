# GroupSchedule

Find a time that works for everyone. GroupSchedule is a calendar-based group
meeting scheduler: an organizer creates a request, drags their availability onto
a weekly calendar (just like dragging an event in Google Calendar), and shares a
link. Anyone can add their availability — with just a name, no account required —
and GroupSchedule highlights the overlapping windows long enough to fit the
meeting, ranked best-first, across time zones.

## How it works

1. **Create a request** — pick the dates and the daily window you'd consider, and
   set a target meeting length (a guideline, not a hard slot).
2. **Drag your availability** — block out when you're free on the weekly grid;
   resize the edges, drag to move, or remove a block.
3. **Share the link** — invitees respond with just a name, or log in to manage
   responses across events.
4. **See what works** — an interval overlap engine shades everyone's combined
   availability and suggests the meeting windows that fit your duration.

## Tech stack

- **Next.js** (App Router) + **React** + **TypeScript**, deployed on **Vercel**
- **Tailwind CSS**
- **Supabase** — Postgres, Auth (email/password), Row-Level Security, and
  security-definer RPCs for the public share flow
- **luxon** for time-zone math

## Project layout

```
src/
  app/                  routes (landing, auth, dashboard, events/new, e/[slug])
  components/           WeekGrid (drag-to-create), SuggestedTimes, ParticipantList…
  lib/
    supabase/           browser / server / proxy clients
    scheduling.ts       interval sweep-line overlap + suggestion engine
    time.ts             grid geometry + time-zone helpers
  proxy.ts              refreshes the Supabase session cookie
supabase/migrations/    0001_init.sql — schema, RLS, RPCs
tests/                  scheduling engine unit tests (vitest)
```

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:3000
```

Apply the database schema by running `supabase/migrations/0001_init.sql` against
your Supabase project (SQL editor or the Supabase CLI).

```bash
npm test          # run the scheduling engine tests
npm run build     # production build
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `NEXT_PUBLIC_SITE_URL` | Base URL used to build share links (optional in dev) |

## License

GroupSchedule is free software, licensed under the
[GNU General Public License v3.0 or later](LICENSE).
