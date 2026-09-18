import { AskPanel } from "@/components/ask/ask-panel";
import { AskProvider } from "@/components/ask/ask-provider";
import { getCurrentUser } from "@/lib/identity";
import { askSuggestions } from "@/lib/ask/suggestions";

/**
 * Everything inside a space shares one Ask Cira.
 *
 * Here rather than in each page's shell because a layout is kept mounted as
 * someone moves between the pages beneath it: the panel stays open, and an
 * answer still arriving keeps arriving, while they open the app it is about.
 * The pages do their own access checks; this only needs to know who is asking.
 */
export default async function SpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ spaceSlug: string }>;
}) {
  const [{ spaceSlug }, user] = await Promise.all([params, getCurrentUser()]);
  if (user === null) return children;

  // Nothing to suggest is a fine answer; failing to work it out should never
  // cost someone the page.
  const { suggestions, unsettled } = await askSuggestions(user, spaceSlug).catch(() => ({
    suggestions: [],
    unsettled: false,
  }));

  return (
    <AskProvider
      userId={user.id}
      spaceSlug={spaceSlug}
      suggestions={suggestions}
      unsettled={unsettled}
    >
      {children}
      <AskPanel />
    </AskProvider>
  );
}
