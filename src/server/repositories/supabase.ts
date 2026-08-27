/**
 * Every repository starts here. Keeping the import in one place means grepping
 * for `supabaseAdmin` tells you exactly which files touch the database — and
 * that list should never grow outside `server/repositories/`.
 */
export { supabaseAdmin as db } from "@/utils/supabase/admin";

/** PostgREST returns `{ data, error }`; repositories should never ignore `error`. */
export function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: no rows returned`);
  return result.data;
}

export function unwrapMaybe<T>(result: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}
