/**
 * A person's name, as they give it to Cira.
 *
 * First name is required, because it is what the product greets them by and
 * there is no good greeting for a blank. Last name is optional, because plenty
 * of people do not use one. Neither may be an email address: an address is
 * what Cira was showing in place of a name, which is the thing this replaces.
 */
export type PersonName =
  | { ok: true; firstName: string; lastName: string | null; name: string }
  | { ok: false; error: string };

/** Long enough for any real name, short enough to fit where names are shown. */
export const MAX_NAME_PART = 60;

export function parsePersonName(first: unknown, last: unknown): PersonName {
  const firstName = typeof first === "string" ? first.trim().replace(/\s+/g, " ") : "";
  const lastName = typeof last === "string" ? last.trim().replace(/\s+/g, " ") : "";

  if (firstName === "") return { ok: false, error: "Add your first name." };
  if (firstName.length > MAX_NAME_PART || lastName.length > MAX_NAME_PART) {
    return { ok: false, error: `Names can be up to ${MAX_NAME_PART} characters.` };
  }
  if (firstName.includes("@") || lastName.includes("@")) {
    return {
      ok: false,
      error: "That looks like an email address. Add your name instead.",
    };
  }

  return {
    ok: true,
    firstName,
    lastName: lastName === "" ? null : lastName,
    name: lastName === "" ? firstName : `${firstName} ${lastName}`,
  };
}
