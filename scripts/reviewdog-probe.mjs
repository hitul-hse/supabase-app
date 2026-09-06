/*
 * TEMPORARY. Proves end to end that a house-rule finding reaches a pull
 * request as a review comment on the line that introduced it. Reverted in the
 * next commit; if you are reading this on master, delete it.
 */
export async function unorderedPagedRead(supabase) {
  return supabase.from("entry").select("id, duration_seconds").range(0, 999);
}
