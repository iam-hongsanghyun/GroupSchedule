import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreateEventForm } from "./CreateEventForm";

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold text-slate-900">New scheduling request</h1>
      <p className="mt-1 text-sm text-slate-600">
        Set the window of dates and times you&apos;d consider. You&apos;ll drag
        in your own availability next.
      </p>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
        <CreateEventForm />
      </div>
    </div>
  );
}
