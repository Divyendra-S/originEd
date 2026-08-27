/**
 * Layer 3 only. The secret-key client — bypasses RLS.
 *
 * v1 has no auth, so every table has RLS ON with NO policies: the browser's
 * publishable key reaches nothing, and all real access happens here, behind our
 * own route handlers. Importing this from a component or a route handler
 * defeats the entire arrangement — repositories only.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!secret) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Dashboard > Project Settings > API Keys > " +
        "secret key (sb_secret_...). Required because RLS is on with no policies.",
    );
  }

  cached = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
