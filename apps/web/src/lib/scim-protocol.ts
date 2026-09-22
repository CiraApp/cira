/**
 * SCIM 2.0 (RFC 7643, 7644) as Okta and Microsoft Entra actually speak it.
 *
 * The protocol is small; the dialects are not. Okta deactivates a person with
 * `{"op":"replace","value":{"active":false}}`, Entra with
 * `{"op":"Replace","path":"active","value":"False"}` - a capitalised verb and
 * a boolean as a string. Everything here is pure, so each dialect is a test
 * rather than a surprise in production.
 */

export const SCHEMA = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  list: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
  patch: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
} as const;

export interface UserInput {
  userName: string;
  externalId: string | null;
  givenName: string | null;
  familyName: string | null;
  active: boolean;
}

export interface GroupInput {
  displayName: string;
  externalId: string | null;
  members: string[];
}

export class ScimError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: string,
  ) {
    super(message);
    this.name = "ScimError";
  }
}

export function errorBody(error: ScimError) {
  return {
    schemas: [SCHEMA.error],
    status: String(error.status),
    detail: error.message,
    ...(error.scimType === undefined ? {} : { scimType: error.scimType }),
  };
}

export function listBody<T>(resources: T[], total: number, startIndex: number) {
  return {
    schemas: [SCHEMA.list],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

/** A boolean as either dialect sends one. */
export function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return Boolean(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The address a person signs in with: `userName`, else their primary email. */
function addressOf(body: Record<string, unknown>): string | null {
  const userName = text(body["userName"]);
  if (userName !== null && userName.includes("@")) return userName.toLowerCase();
  const emails = Array.isArray(body["emails"]) ? body["emails"] : [];
  const primary =
    emails.find((e) => (e as { primary?: unknown }).primary === true) ?? emails[0];
  const email = text((primary as { value?: unknown } | undefined)?.value);
  return (email ?? userName)?.toLowerCase() ?? null;
}

/** A user from a POST or PUT body. */
export function parseUser(body: unknown): UserInput {
  if (typeof body !== "object" || body === null) {
    throw new ScimError(400, "The body is not a SCIM user.", "invalidSyntax");
  }
  const record = body as Record<string, unknown>;
  const userName = addressOf(record);
  if (userName === null || !userName.includes("@")) {
    throw new ScimError(
      400,
      "userName must be the person's email address.",
      "invalidValue",
    );
  }
  const name = (record["name"] ?? {}) as Record<string, unknown>;
  return {
    userName,
    externalId: text(record["externalId"]),
    givenName: text(name["givenName"]),
    familyName: text(name["familyName"]),
    active: record["active"] === undefined ? true : truthy(record["active"]),
  };
}

/** A group from a POST or PUT body. */
export function parseGroup(body: unknown): GroupInput {
  if (typeof body !== "object" || body === null) {
    throw new ScimError(400, "The body is not a SCIM group.", "invalidSyntax");
  }
  const record = body as Record<string, unknown>;
  const displayName = text(record["displayName"]);
  if (displayName === null) {
    throw new ScimError(400, "A group needs a displayName.", "invalidValue");
  }
  return {
    displayName,
    externalId: text(record["externalId"]),
    members: memberIds(record["members"]),
  };
}

function memberIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list
    .map((m) => text((m as { value?: unknown } | null)?.value))
    .filter((id): id is string => id !== null);
}

/** What a PATCH to a user changes. */
export interface UserPatch {
  active?: boolean;
  userName?: string;
  externalId?: string | null;
  givenName?: string | null;
  familyName?: string | null;
}

interface Operation {
  op: "add" | "replace" | "remove";
  path: string | null;
  value: unknown;
}

function operations(body: unknown): Operation[] {
  const list = (body as { Operations?: unknown } | null)?.Operations;
  if (!Array.isArray(list)) {
    throw new ScimError(400, "A PATCH needs Operations.", "invalidSyntax");
  }
  return list.map((raw) => {
    const op = String((raw as { op?: unknown }).op ?? "").toLowerCase();
    if (op !== "add" && op !== "replace" && op !== "remove") {
      throw new ScimError(400, `Unknown operation ${op}.`, "invalidSyntax");
    }
    const path = text((raw as { path?: unknown }).path);
    return { op, path, value: (raw as { value?: unknown }).value };
  });
}

export function parseUserPatch(body: unknown): UserPatch {
  const patch: UserPatch = {};
  const apply = (path: string, value: unknown) => {
    switch (path.toLowerCase()) {
      case "active":
        patch.active = truthy(value);
        break;
      case "username":
        if (text(value) !== null) patch.userName = text(value)!.toLowerCase();
        break;
      case "externalid":
        patch.externalId = text(value);
        break;
      case "name.givenname":
        patch.givenName = text(value);
        break;
      case "name.familyname":
        patch.familyName = text(value);
        break;
      case "name": {
        const name = (value ?? {}) as Record<string, unknown>;
        if ("givenName" in name) patch.givenName = text(name["givenName"]);
        if ("familyName" in name) patch.familyName = text(name["familyName"]);
        break;
      }
      default:
        // Attributes Cira does not keep - titles, phone numbers - are
        // accepted and ignored, as the protocol allows, rather than failing a
        // whole push over a field nothing here reads.
        break;
    }
  };
  for (const operation of operations(body)) {
    if (operation.op === "remove") continue;
    if (operation.path !== null) {
      apply(operation.path, operation.value);
    } else if (typeof operation.value === "object" && operation.value !== null) {
      for (const [key, value] of Object.entries(operation.value)) apply(key, value);
    }
  }
  return patch;
}

/** What a PATCH to a group changes. */
export interface GroupPatch {
  displayName?: string;
  add: string[];
  remove: string[];
  /** Set when the members are replaced outright. */
  replace?: string[];
}

export function parseGroupPatch(body: unknown): GroupPatch {
  const patch: GroupPatch = { add: [], remove: [] };
  const members = (op: Operation["op"], ids: string[]) => {
    if (op === "add") patch.add.push(...ids);
    else if (op === "remove") patch.remove.push(...ids);
    else patch.replace = ids;
  };

  for (const { op, path, value } of operations(body)) {
    const target = path?.toLowerCase() ?? null;
    if (target === "displayname") {
      const name = text(value);
      if (name !== null) patch.displayName = name;
    } else if (target === "members") {
      members(op, memberIds(value));
    } else if (target?.startsWith("members[")) {
      // Entra removes one member as `members[value eq "id"]`.
      const id = /^members\[value eq "([^"]+)"\]$/i.exec(path ?? "")?.[1];
      if (id !== undefined) members(op, [id]);
    } else if (target === null && typeof value === "object" && value !== null) {
      // Okta sends what changes as the value itself, with no path.
      const record = value as Record<string, unknown>;
      const name = text(record["displayName"]);
      if (name !== null) patch.displayName = name;
      if ("members" in record) members(op, memberIds(record["members"]));
    }
  }
  return patch;
}

/** `attr eq "value"`, the one filter identity providers send. */
export function parseFilter(
  filter: string | null,
): { attribute: string; value: string } | null {
  if (filter === null || filter.trim() === "") return null;
  const match = /^\s*([A-Za-z.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (match === null) {
    throw new ScimError(
      400,
      'Only `attribute eq "value"` filters are understood.',
      "invalidFilter",
    );
  }
  return { attribute: match[1]!.toLowerCase(), value: match[2]!.replace(/\\(.)/g, "$1") };
}
