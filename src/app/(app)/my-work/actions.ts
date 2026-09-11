"use server";

/**
 * The customer's contact persons for ONE selected order on My Work.
 *
 * WHY AN ACTION
 * -------------
 * public.project_contact holds personal data of third parties (Ansprechpartner
 * 1 and 2 of a service order), and the migration that created it promises
 * they are read "for one selected order at a time". The page used to read them
 * for the person's whole book of work and serialise every one into the client
 * component's props, so a browser that never opened a single row still held
 * every contact of every order. Now the page carries none, and the detail
 * panel asks for the one project it is showing, when it is showing it.
 *
 * WHO MAY ASK
 * -----------
 * A server action is a public POST endpoint, so the session is checked here
 * before anything is read -- an anonymous call never reaches the query. The
 * read itself goes through the ordinary cookie-bound client, so
 * `can_view_project(project_id)` (the table's only SELECT policy) decides which
 * rows come back, exactly as it did on the page. Nothing here uses the service
 * role, and nothing should: a key that sees everything would turn "the
 * project's people read, nobody else" into "anyone who knows a project id".
 *
 * A project the caller may not see returns no rows, which the panel renders as
 * "no contact recorded" -- the same answer the table gives that caller directly,
 * so the action discloses nothing a signed-in session could not already ask
 * PostgREST for.
 */
import { createClient } from "@/utils/supabase/server";
import { getSignedInUser } from "@/lib/queries/request-cache";
import { fetchProjectContacts, type MyContact } from "@/lib/queries/my-work";

export type ProjectContactsResult = {
  contacts: MyContact[];
  /** True when the read failed; the panel says "could not load", never "none". */
  failed: boolean;
};

export async function loadProjectContacts(projectId: string): Promise<ProjectContactsResult> {
  // The argument arrives from the network, whatever its TypeScript type says.
  // projects.id is text; 128 characters is far beyond any id in the table and
  // well short of anything that could make the request itself a problem.
  if (typeof projectId !== "string" || projectId.length === 0 || projectId.length > 128) {
    return { contacts: [], failed: true };
  }

  const supabase = await createClient();
  const user = await getSignedInUser(supabase);
  if (!user) return { contacts: [], failed: true };

  return fetchProjectContacts(supabase, projectId);
}
