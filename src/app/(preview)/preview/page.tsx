import { WorkspacePage } from "@/workspace/page";

/**
 * The whole preview route. Everything below this line is the user's page, and
 * every byte of it is inside the jail — which is what lets the agent edit it.
 *
 * `?page=` is the studio's page switcher (§10). It is read HERE, outside the
 * jail, and handed down as a prop, so the agent can rewrite `page.tsx`'s registry
 * without ever touching the route that serves it.
 *
 * Reading a search param opts this route into dynamic rendering, which it wants
 * to be anyway: it renders whatever the workspace says right now, and a cached
 * copy of the page you are editing is the one thing it must never serve.
 */
export default async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const params = await searchParams;
  // `?page=a&page=b` is not a thing the studio sends; take the first rather than
  // rendering nothing because someone typed a URL by hand. An unknown value is
  // the first page, not a blank frame — `sectionsForPage` decides that.
  const page = Array.isArray(params.page) ? params.page[0] : params.page;
  return <WorkspacePage page={page} />;
}
