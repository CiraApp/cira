import "server-only";

import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db, spaceSso } from "@cira/db";
import { emailDomain } from "@/lib/email-domain";

/**
 * A company signing in through its own identity provider - Okta, Entra,
 * Google Workspace - rather than by an emailed code.
 *
 * Clerk does the protocol. Cira's part is to set up one enterprise connection
 * per company for its email domain, show the company's admin what their
 * identity provider needs, and take its metadata back. After that, anyone who
 * types an address at that domain is sent to their company to sign in, and
 * leaving the company there is leaving it here.
 *
 * Only someone with an address at the domain can set it up for the domain:
 * that is the proof Cira has that the company is theirs to speak for.
 */

export interface SsoDetails {
  domain: string;
  active: boolean;
  /** What the identity provider needs from Cira. */
  acsUrl: string | null;
  spEntityId: string | null;
  spMetadataUrl: string | null;
  /** Where the identity provider's own metadata was given from. */
  idpMetadataUrl: string | null;
}

export type SsoOutcome = { ok: true; details: SsoDetails } | { ok: false; error: string };

export async function ssoFor(spaceId: string): Promise<SsoDetails | null> {
  const [row] = await db()
    .select()
    .from(spaceSso)
    .where(eq(spaceSso.spaceId, spaceId))
    .limit(1);
  if (row === undefined) return null;
  try {
    const connection = await (
      await clerkClient()
    ).enterpriseConnections.getEnterpriseConnection(row.connectionId);
    return detailsOf(row, connection.samlConnection);
  } catch {
    // Clerk out of reach: say what Cira knows rather than nothing.
    return detailsOf(row, null);
  }
}

/** The first half: a connection for the domain, and what the provider needs. */
export async function startSso(args: {
  spaceId: string;
  spaceName: string;
  userId: string;
  userEmail: string;
  domain: string;
}): Promise<SsoOutcome> {
  const domain = args.domain.trim().toLowerCase();
  if (emailDomain(args.userEmail) !== domain) {
    return {
      ok: false,
      error: `Only someone who signs in with an @${domain} address can set up sign-in for ${domain}.`,
    };
  }
  const existing = await ssoFor(args.spaceId);
  if (existing !== null) return { ok: true, details: existing };

  try {
    const connection = await (
      await clerkClient()
    ).enterpriseConnections.createEnterpriseConnection({
      name: args.spaceName,
      domains: [domain],
      provider: "saml_custom",
      active: false,
    });
    const row = {
      spaceId: args.spaceId,
      connectionId: connection.id,
      domain,
      idpMetadataUrl: null,
      active: false,
      createdByUserId: args.userId,
    };
    await db().insert(spaceSso).values(row);
    return { ok: true, details: detailsOf(row, connection.samlConnection) };
  } catch (error) {
    return { ok: false, error: ssoFailure(error, domain) };
  }
}

/**
 * The second half: the provider's metadata, and the connection switched on.
 * From this moment everyone at the domain signs in through their company.
 */
export async function finishSso(args: {
  spaceId: string;
  idpMetadataUrl: string;
}): Promise<SsoOutcome> {
  const [row] = await db()
    .select()
    .from(spaceSso)
    .where(eq(spaceSso.spaceId, args.spaceId))
    .limit(1);
  if (row === undefined) return { ok: false, error: "Start by giving the domain." };

  let url: URL;
  try {
    url = new URL(args.idpMetadataUrl.trim());
  } catch {
    return { ok: false, error: "That is not an address. Paste the metadata URL itself." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "The metadata has to come from an https:// address." };
  }

  try {
    const client = await clerkClient();
    await client.enterpriseConnections.updateEnterpriseConnection(row.connectionId, {
      saml: { idpMetadataUrl: url.toString() },
    });
    const connection = await client.enterpriseConnections.updateEnterpriseConnection(
      row.connectionId,
      { active: true },
    );
    const updated = { ...row, idpMetadataUrl: url.toString(), active: true };
    await db()
      .update(spaceSso)
      .set({
        idpMetadataUrl: updated.idpMetadataUrl,
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(spaceSso.spaceId, args.spaceId));
    return { ok: true, details: detailsOf(updated, connection.samlConnection) };
  } catch (error) {
    return { ok: false, error: ssoFailure(error, row.domain) };
  }
}

/** Back to emailed codes. Removing the space does this too. */
export async function removeSso(
  spaceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db()
    .select()
    .from(spaceSso)
    .where(eq(spaceSso.spaceId, spaceId))
    .limit(1);
  if (row === undefined) return { ok: true };
  try {
    await (
      await clerkClient()
    ).enterpriseConnections.deleteEnterpriseConnection(row.connectionId);
  } catch (error) {
    if (statusOf(error) !== 404)
      return { ok: false, error: ssoFailure(error, row.domain) };
  }
  await db().delete(spaceSso).where(eq(spaceSso.spaceId, spaceId));
  return { ok: true };
}

function detailsOf(
  row: { domain: string; active: boolean; idpMetadataUrl: string | null },
  saml: {
    acsUrl?: string | undefined;
    spEntityId?: string | undefined;
    spMetadataUrl?: string | undefined;
  } | null,
): SsoDetails {
  return {
    domain: row.domain,
    active: row.active,
    acsUrl: saml?.acsUrl ?? null,
    spEntityId: saml?.spEntityId ?? null,
    spMetadataUrl: saml?.spMetadataUrl ?? null,
    idpMetadataUrl: row.idpMetadataUrl,
  };
}

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

function ssoFailure(error: unknown, domain: string): string {
  const said = (error as { errors?: Array<{ code?: string; message?: string }> } | null)
    ?.errors?.[0];
  const status = statusOf(error);
  if (status === 402 || /feature|plan|upgrade/i.test(`${said?.code} ${said?.message}`)) {
    return "Signing in through a company's own provider needs Cira's Clerk account on its Pro plan. Tell whoever runs Cira.";
  }
  if (/domain/i.test(`${said?.code} ${said?.message}`) && status === 422) {
    return `${domain} is already set up for sign-in elsewhere.`;
  }
  if (/metadata/i.test(`${said?.message}`)) {
    return "Clerk could not read the metadata at that address. Check it opens in a browser.";
  }
  return "Clerk, which signs people in, did not answer. Try again in a minute.";
}
