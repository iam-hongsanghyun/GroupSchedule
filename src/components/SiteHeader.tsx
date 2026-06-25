import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/lib/auth-actions";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const meta = user?.user_metadata ?? {};
  const name =
    (meta.display_name as string | undefined) ??
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    user?.email?.split("@")[0];

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-sm text-white">
            GS
          </span>
          <span>GroupSchedule</span>
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100"
              >
                Dashboard
              </Link>
              <span className="hidden text-slate-400 sm:inline">·</span>
              <span className="hidden text-slate-600 sm:inline">{name}</span>
              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
