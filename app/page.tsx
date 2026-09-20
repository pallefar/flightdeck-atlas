import Atlas from "./atlas";
import { getAccess } from "@/lib/access";
import { requireChatGPTUser } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view =
    typeof params.view === "string" &&
    [
      "dashboard",
      "globe",
      "connection",
      "briefing",
      "ideas",
      "access",
      "wellbeing",
      "today",
      "apps",
      "team",
      "presentations",
    ].includes(params.view)
      ? params.view
      : null;
  const returnParams = new URLSearchParams();
  if (view) returnParams.set("view", view);
  for (const key of ["project", "work", "form", "look"]) {
    const value = params[key];
    if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value))
      returnParams.set(key, value);
  }
  await requireChatGPTUser(returnParams.size ? `/?${returnParams}` : "/");
  let access;
  try {
    access = await getAccess();
  } catch {
    return (
      <main className="document-page">
        <h1>Access temporarily unavailable</h1>
        <p>Your access could not be verified. Please reload in a moment.</p>
      </main>
    );
  }
  if (!access)
    return (
      <main className="document-page">
        <h1>Access requires a grant</h1>
        <p>
          Ask the Atlas Super Admin to grant access to your sign-in email.
          Signing in alone does not grant dashboard access.
        </p>
      </main>
    );
  return <Atlas />;
}
