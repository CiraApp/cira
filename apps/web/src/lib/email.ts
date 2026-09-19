import "server-only";

/**
 * Sending email, through Resend.
 *
 * One call to one endpoint, so it is made directly rather than through an
 * SDK. Configured by `RESEND_API_KEY`; without one - development, tests, a
 * deploy that has not been given it - nothing is sent and the caller is told
 * so, and whatever wanted to send carries on. Email is how Cira tells people
 * things, never something a request waits on to succeed.
 */

/** One email to one person, so nobody sees who else it went to. */
export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailOutcome =
  { sent: true } | { sent: false; reason: "not-configured" | "refused" | "unreachable" };

const RESEND_API = "https://api.resend.com/emails";

/** Who Cira's email comes from. Its domain has to be verified with Resend. */
export const EMAIL_FROM = "Cira <notifications@cira.dev>";

export async function sendEmail(
  email: Email,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailOutcome> {
  const key = env["RESEND_API_KEY"]?.trim();
  if (key === undefined || key === "") return { sent: false, reason: "not-configured" };

  let response: Response;
  try {
    response = await fetchImpl(RESEND_API, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env["CIRA_EMAIL_FROM"]?.trim() || EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { sent: false, reason: "unreachable" };
  }

  if (!response.ok) {
    // Resend's own words can name the account; its status is enough to act on.
    console.warn(`email refused by Resend: ${response.status}`);
    return { sent: false, reason: "refused" };
  }
  return { sent: true };
}

/** Whether this Cira can send email at all, for a page deciding what to promise. */
export function emailConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const key = env["RESEND_API_KEY"]?.trim();
  return key !== undefined && key !== "";
}

/** Where Cira's own pages are, for links in email, which has no request to ask. */
export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  return (env["CIRA_APP_URL"]?.trim() || "https://cira.dev").replace(/\/+$/, "");
}
