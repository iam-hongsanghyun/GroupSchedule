"use client";

import { useState } from "react";

/** Copies an absolute share URL (built from the current origin) to the clipboard. */
export function CopyButton({
  slug,
  label = "Copy link",
}: {
  slug: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/e/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fall back to prompt.
      window.prompt("Copy this link:", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
