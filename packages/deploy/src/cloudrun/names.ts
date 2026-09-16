/**
 * What a Cira app is called once it reaches Google.
 *
 * Cloud Run is stricter than Cira about names - lowercase, alphanumeric and
 * hyphens, at most 63 characters, starting with a letter - and a name that
 * does not fit is rejected at create time rather than trimmed. Every name a
 * deploy needs is derived here so there is one place that knows the rules, and
 * one place to look when Google refuses something.
 */

/** Cloud Run's own limit on a service name. */
export const MAX_SERVICE_NAME = 63;

/**
 * A Cira space and app, as one Cloud Run service name.
 *
 * Truncated from the middle of the app slug rather than the end when it will
 * not fit, because the space tells you whose it is and the start of an app
 * name tells you which - and the tail of a long slug tells you neither. A hash
 * suffix keeps two long names in one space from colliding into each other.
 */
export function serviceName(spaceSlug: string, appSlug: string): string {
  const base = `${clean(spaceSlug)}-${clean(appSlug)}`;
  if (base.length <= MAX_SERVICE_NAME && /^[a-z]/.test(base)) return base;

  const prefixed = /^[a-z]/.test(base) ? base : `a${base}`;
  if (prefixed.length <= MAX_SERVICE_NAME) return prefixed;

  // Deterministic, so the same app always lands on the same service: a deploy
  // that invented a new name each time would orphan the previous one.
  const suffix = `-${shortHash(`${spaceSlug}/${appSlug}`)}`;
  return `${prefixed.slice(0, MAX_SERVICE_NAME - suffix.length)}${suffix}`.replace(
    /-+$/,
    "",
  );
}

/** Where the built image lives, tagged by the build that produced it. */
export function imageRef(args: {
  region: string;
  projectId: string;
  repository: string;
  service: string;
  buildId: string;
}): string {
  const { region, projectId, repository, service, buildId } = args;
  return `${region}-docker.pkg.dev/${projectId}/${repository}/${service}:${buildId}`;
}

/**
 * The object a deploy's source archive is uploaded to.
 *
 * Keyed on the uploading user, not on the app, because the app does not exist
 * yet: `cira deploy` uploads before it says which space to publish into, and
 * on a first deploy the app is created by that later call. The user is the one
 * thing already known.
 *
 * That ordering turns out to be the safer shape anyway. A deploy names the
 * source it wants by id alone, and this rebuilds the path from the *caller's*
 * own id, so an id belonging to someone else does not resolve to their upload.
 * There is no request in which one person can build from another's source.
 */
export function sourceObject(userId: string, sourceId: string): string {
  return `sources/${safe(userId, "user")}/${safe(sourceId, "source")}.tar.gz`;
}

/**
 * Both halves end up inside a URL path, so they are checked rather than
 * trusted. Cira's own ids always pass; this exists for the day something
 * constructs one from user input and nobody notices.
 */
function safe(value: string, what: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error(`Not a usable ${what} id.`);
  }
  return value;
}

/** The fully qualified name the Cloud Run API addresses a service by. */
export function servicePath(args: {
  projectId: string;
  region: string;
  service: string;
}): string {
  return `projects/${args.projectId}/locations/${args.region}/services/${args.service}`;
}

function clean(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A short, stable discriminator. Not a security boundary - it exists so two
 * long names do not truncate onto each other, and collisions there are
 * inconvenient rather than dangerous.
 */
function shortHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}
