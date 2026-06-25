"use client";

import { useFormStatus } from "react-dom";

/** A submit button that disables itself and shows pending text while the
 *  enclosing form's action is running. Must be rendered inside a <form>. */
export function SubmitButton({
  children,
  pendingText = "Working…",
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
