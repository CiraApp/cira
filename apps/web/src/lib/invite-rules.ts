import type { Role } from "@cira/core";

/**
 * Whether an invite can be accepted, decided from records alone.
 *
 * Kept free of the database and the session so the rules can be tested
 * directly. Every refusal carries the sentence the person should read: an
 * invite that silently does nothing is the worst version of this screen.
 */
export interface InviteRecord {
  email: string;
  role: Role;
  acceptedAt: Date | null;
  expiresAt: Date;
}

export type InviteVerdict =
  | { ok: true }
  | { ok: false; code: "expired" | "used" | "wrong-account"; message: string };

export function checkInvite(args: {
  invite: InviteRecord;
  viewerEmail: string;
  now: Date;
}): InviteVerdict {
  const { invite, viewerEmail, now } = args;

  if (invite.acceptedAt !== null) {
    return {
      ok: false,
      code: "used",
      message: "This invite has already been used.",
    };
  }

  if (invite.expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      code: "expired",
      message: "This invite has expired. Ask for a new one.",
    };
  }

  // The invite names a person, not just a company. A forwarded link must not
  // let someone else into an internal workspace.
  if (invite.email.trim().toLowerCase() !== viewerEmail.trim().toLowerCase()) {
    return {
      ok: false,
      code: "wrong-account",
      message: `This invite was sent to ${invite.email}. Sign in with that address to accept it.`,
    };
  }

  return { ok: true };
}

/** Invites are valid for a week: long enough to be seen, short enough to lapse. */
export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_LIFETIME_MS);
}
