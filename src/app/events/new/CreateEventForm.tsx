"use client";

import { useEffect, useState } from "react";
import { createEvent } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export function CreateEventForm() {
  const [timezone, setTimezone] = useState("UTC");
  const [zones, setZones] = useState<string[]>([]);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setTimezone(tz);
    try {
      const supported =
        (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
          .supportedValuesOf?.("timeZone") ?? [];
      setZones(supported.length ? supported : [tz]);
    } catch {
      setZones([tz]);
    }
  }, []);

  return (
    <form action={createEvent} className="space-y-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Title</label>
        <input name="title" required placeholder="e.g. Q3 planning sync" className={inputClass} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Description <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea name="description" rows={2} className={inputClass} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Meeting length (guideline)
          </label>
          <select name="duration" defaultValue="60" className={inputClass}>
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">1 hour</option>
            <option value="90">1.5 hours</option>
            <option value="120">2 hours</option>
            <option value="180">3 hours</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Snap dragging to
          </label>
          <select name="snap_minutes" defaultValue="15" className={inputClass}>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Your time zone</label>
        <select
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className={inputClass}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">
          The calendar is anchored to this zone. Invitees can view it in their own.
        </p>
      </div>

      <SubmitButton
        pendingText="Creating…"
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        Create request &amp; open calendar
      </SubmitButton>
    </form>
  );
}
