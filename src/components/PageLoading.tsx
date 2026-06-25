export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}
