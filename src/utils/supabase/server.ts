/**
 * Cookie-bound server client, for when auth arrives. v1 reads and writes through
 * `admin.ts` instead, so nothing calls this yet.
 *
 * Note the `setAll(cookies, headers)` shape — @supabase/ssr 0.12 passes
 * cache-control headers as a second argument that older snippets omit.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet, headers) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
            void headers;
          } catch {
            // Called from a Server Component — the proxy refreshes sessions instead.
          }
        },
      },
    },
  );
}
