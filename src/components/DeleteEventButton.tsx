"use client";

import { deleteEvent } from "@/app/dashboard/actions";

export function DeleteEventButton({ id, title }: { id: string; title: string }) {
  return (
    <form
      action={deleteEvent}
      onSubmit={(e) => {
        if (
          !confirm(
            `Delete "${title}"? This permanently removes the request and everyone's responses.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
      >
        Delete
      </button>
    </form>
  );
}
