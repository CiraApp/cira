import { roleAtLeast } from "./permissions.js";
import type { Role } from "./model.js";

/**
 * Who may change who is in a space, and how.
 *
 * Pure, over the roles involved, so every rule is tested directly and the
 * server actions only load records and ask. The shape of it:
 *
 * - Admins look after members: they change a member's role between member and
 *   admin, and remove members and other admins.
 * - Only an owner can make someone an owner, change an owner's role, or remove
 *   an owner. A space can have several; the founder is simply the first.
 * - A space always keeps at least one owner. The last one can neither leave,
 *   be removed, nor step down until they have made someone else an owner -
 *   otherwise nobody could delete the space, manage its billing, or appoint
 *   anyone again.
 * - Anyone can leave, under the same last-owner rule.
 */

export type MembershipVerdict = { ok: true } | { ok: false; reason: string };

const LAST_OWNER = "A space needs at least one owner. Make someone else an owner first.";

export function checkRoleChange(args: {
  actorRole: Role;
  targetRole: Role;
  nextRole: Role;
  /** Owners the space has now, including the target if they are one. */
  owners: number;
  /** Whether the actor is changing their own role. */
  self: boolean;
}): MembershipVerdict {
  const { actorRole, targetRole, nextRole, owners, self } = args;

  if (nextRole === targetRole) return { ok: true };
  if (!roleAtLeast(actorRole, "admin")) {
    return { ok: false, reason: "Only admins and owners can change someone's role." };
  }
  if ((targetRole === "owner" || nextRole === "owner") && actorRole !== "owner") {
    return { ok: false, reason: "Only an owner can make or change an owner." };
  }
  if (self && actorRole === "admin" && nextRole === "member") {
    // Allowed: an admin may step down. Stated so the next rule is not read as
    // forbidding it.
    return { ok: true };
  }
  if (targetRole === "owner" && owners <= 1) {
    return { ok: false, reason: LAST_OWNER };
  }
  return { ok: true };
}

export function checkRemoval(args: {
  actorRole: Role;
  targetRole: Role;
  owners: number;
  self: boolean;
}): MembershipVerdict {
  const { actorRole, targetRole, owners, self } = args;

  if (targetRole === "owner" && owners <= 1) {
    return {
      ok: false,
      reason: self
        ? "You are this space's only owner. Make someone else an owner before you leave, or delete the space from its settings."
        : LAST_OWNER,
    };
  }
  if (self) return { ok: true };
  if (!roleAtLeast(actorRole, "admin")) {
    return { ok: false, reason: "Only admins and owners can remove people." };
  }
  if (targetRole === "owner" && actorRole !== "owner") {
    return { ok: false, reason: "Only an owner can remove an owner." };
  }
  return { ok: true };
}
