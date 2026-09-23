/**
 * The record of who changed what about a company.
 *
 * Cira already records who *ran* what - every capability call, with the person
 * and the time and never the input. What was missing is the other half: who
 * made someone an admin, who let an agent write, who put the company's
 * sign-in behind its own identity provider. Those are the changes an auditor
 * asks about, and the changes a company asks about after something goes
 * wrong, and until now the only answer was the state they left behind.
 *
 * The rules this record lives by:
 *
 * - It says what happened, never with what. A token's value, a variable's
 *   value and a person's input are all outside it, the same way they are
 *   outside everything else Cira keeps.
 * - It keeps the words, not the ids. A person removed from the company, or an
 *   app deleted, must not take the record of it with them, so each entry
 *   carries the name it happened to as it read at the time.
 * - Nothing edits it, and nothing deletes from it except the company itself
 *   going away.
 */

/** Everything worth writing down, by what happened. */
export const CHANGE_KINDS = {
  "role-changed": "changed a role",
  "member-removed": "removed someone",
  "member-left": "left",
  "member-joined": "joined",
  "invite-sent": "invited someone",
  "invite-revoked": "took back an invite",
  "team-created": "made a team",
  "team-renamed": "renamed a team",
  "team-deleted": "deleted a team",
  "team-membership-changed": "changed who is in a team",
  "access-granted": "gave access to an app",
  "access-level-changed": "changed access to an app",
  "access-revoked": "took away access to an app",
  "capability-enabled": "let agents run something",
  "capability-disabled": "stopped agents running something",
  "identity-passed-on": "changed whether an app is told who is calling",
  "domain-added": "gave an app its own address",
  "domain-removed": "took away an app's own address",
  "sso-begun": "started setting up single sign-on",
  "sso-enabled": "turned on single sign-on",
  "sso-stopped": "turned off single sign-on",
  "scim-token-made": "made a directory sync token",
  "scim-stopped": "stopped directory sync",
  "app-rolled-back": "put an app back on an earlier build",
  "app-deleted": "deleted an app",
  "space-renamed": "renamed the company",
  "join-by-domain-changed": "changed who may join by email domain",
} as const;

export type ChangeKind = keyof typeof CHANGE_KINDS;

export interface Change {
  id: string;
  spaceId: string;
  kind: ChangeKind;
  /**
   * Who did it, as it read at the time: a person's name, or the name of the
   * system that did it where no person did - a company's own directory
   * pushing a change over SCIM is not one of its admins doing it.
   */
  actor: string;
  /** The user who did it, where one did and is still here. */
  actorUserId: string | null;
  /** What it was done to, in the words a person would use: a name, an address. */
  subject: string;
  /** The app it was about, when it was about one. */
  appId: string | null;
  /** What changed, where "from this to that" is the point: "member to admin". */
  detail: string | null;
  at: Date;
}

/**
 * One line of the record, as a sentence.
 *
 * Written here rather than at each place a change is recorded, so the record
 * reads as one voice and a new kind of change cannot enter it unworded.
 */
export function describeChange(change: {
  kind: ChangeKind;
  actor: string;
  subject: string;
  detail: string | null;
}): string {
  const { actor, subject, detail } = change;
  const to = detail === null ? "" : ` ${detail}`;

  switch (change.kind) {
    case "role-changed":
      return `${actor} changed ${subject}${to === "" ? "'s role" : ` from${to}`}`;
    case "member-removed":
      return `${actor} removed ${subject}`;
    case "member-left":
      return `${subject} left`;
    case "member-joined":
      return `${subject} joined${to}`;
    case "invite-sent":
      return `${actor} invited ${subject}${to === "" ? "" : ` as${to}`}`;
    case "invite-revoked":
      return `${actor} took back the invitation to ${subject}`;
    case "team-created":
      return `${actor} made the team ${subject}`;
    case "team-renamed":
      return `${actor} renamed the team ${subject}${to === "" ? "" : ` to${to}`}`;
    case "team-deleted":
      return `${actor} deleted the team ${subject}`;
    case "team-membership-changed":
      return `${actor} changed who is in ${subject}:${to}`;
    case "access-granted":
      return `${actor} gave ${subject} access to ${detail ?? "an app"}`;
    case "access-level-changed":
      return `${actor} changed ${subject}'s access${to === "" ? "" : ` to${to}`}`;
    case "access-revoked":
      return detail === null
        ? `${actor} took away ${subject}'s access`
        : `${actor} took away ${subject}'s access to ${detail}`;
    case "capability-enabled":
      return `${actor} let agents run ${subject}`;
    case "capability-disabled":
      return `${actor} stopped agents running ${subject}`;
    case "identity-passed-on":
      return `${actor} ${detail === "on" ? "started" : "stopped"} telling ${subject} who is calling`;
    case "domain-added":
      return `${actor} gave ${subject} the address ${detail ?? "of its own"}`;
    case "domain-removed":
      return `${actor} took ${detail ?? "an address"} away from ${subject}`;
    case "sso-begun":
      return `${actor} started setting up single sign-on for ${subject}`;
    case "sso-enabled":
      return `${actor} turned on single sign-on for ${subject}`;
    case "sso-stopped":
      return `${actor} turned off single sign-on for ${subject}`;
    case "scim-token-made":
      return `${actor} made a directory sync token`;
    case "scim-stopped":
      return `${actor} stopped directory sync`;
    case "app-rolled-back":
      return `${actor} put ${subject} back on ${detail ?? "an earlier build"}`;
    case "app-deleted":
      return `${actor} deleted ${subject}`;
    case "space-renamed":
      return `${actor} renamed the company to ${subject}`;
    case "join-by-domain-changed":
      return detail === "on"
        ? `${actor} let anyone with an @${subject} address join`
        : `${actor} stopped anyone with an @${subject} address joining`;
  }

  // Unreachable for every kind above, and kept for the row a later version of
  // Cira wrote and this one has not heard of: a line that reads a little flat
  // beats a blank one in a record whose whole worth is that nothing is missing.
  return `${actor} changed something about ${subject}`;
}
