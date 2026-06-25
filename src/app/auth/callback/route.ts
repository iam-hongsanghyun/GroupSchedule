import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles the email-confirmation / OAuth code exchange. Reached when a user
 * clicks the confirmation link (only relevant if email confirmation is on).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Persist the Google refresh token (present when offline access is
      // granted) so the server can call the Calendar API later.
      const refreshToken = data.session?.provider_refresh_token;
      const uid = data.session?.user?.id;
      if (refreshToken && uid) {
        await supabase
          .from("google_credentials")
          .upsert({ user_id: uid, refresh_token: refreshToken });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could not sign in`);
}
