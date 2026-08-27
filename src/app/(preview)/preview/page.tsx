import { WorkspacePage } from "@/workspace/page";

/**
 * The whole preview route. Everything below this line is the user's page, and
 * every byte of it is inside the jail — which is what lets the agent edit it.
 */
export default function Preview() {
  return <WorkspacePage />;
}
