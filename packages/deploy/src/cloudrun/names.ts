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
 * The id is in the name, and it has to be. Cloud Run allows only lowercase
 * letters, digits and hyphens, so a space slug and an app slug joined by a
 * hyphen cannot be taken apart again: space `acme-corp` with app `ledger` and
 * space `acme` with app `corp-ledger` both read as `acme-corp-ledger`. Those
 * are two apps belonging to two different companies, and whichever deployed
 * second would have taken over the other's service - its image and, worse, its
 * environment. A slug is chosen by whoever creates the space, so that is not
 * only an accident waiting to happen.
 *
 * The slugs stay in front because a name nobody can read is its own kind of
 * problem when something is wrong at three in the morning. The id on the end
 * is what makes it unambiguous.
 */
export function serviceName(args: {
  spaceSlug: string;
  appSlug: string;
  appId: string;
}): string {
  const suffix = `-${discriminator(args.appId)}`;
  const base = `${clean(args.spaceSlug)}-${clean(args.appSlug)}`;
  const prefixed = /^[a-z]/.test(base) ? base : `a${base}`;

  const room = MAX_SERVICE_NAME - suffix.length;
  // Truncated from the end of the app slug rather than the start of the space,
  // because the space tells you whose it is and the start of an app name tells
  // you which; the tail of a long slug tells you neither.
  const head = prefixed.slice(0, room).replace(/-+$/, "");

  return `${head}${suffix}`;
}

/**
 * The part that guarantees two apps never land on one service.
 *
 * Taken from the app's own id, which is already unique, rather than hashed
 * from the names - a hash of the names would have exactly the collision this
 * exists to prevent, just less often.
 */
function discriminator(appId: string): string {
  const cleaned = appId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (cleaned.length < 8) throw new Error("Not a usable app id.");
  return cleaned.slice(-8);
}

/**
 * Where the built image lives, tagged by the source it was built from.
 *
 * Tagged by source rather than by build, which is not the obvious choice: the
 * build id would read better in a console. But the image name has to be
 * written into the build request, and a build does not have an id until that
 * request has been accepted - so a build-id tag cannot be known in time. The
 * source id can, is unique per deploy, and says something more useful anyway,
 * which is which bytes produced this image.
 */
export function imageRef(args: {
  region: string;
  projectId: string;
  repository: string;
  service: string;
  tag: string;
}): string {
  const { region, projectId, repository, service, tag } = args;
  return `${region}-docker.pkg.dev/${projectId}/${repository}/${service}:${tag}`;
}

/**
 * What Cira stores as a deployment's provider id.
 *
 * A Cloud Run deploy is two things and the interface has room for one string,
 * so the string carries both. A build makes an image; a service serves it, and
 * knowing only the build id would leave no way to find the service it was for.
 * The image tag rides along for the same reason - the deploy that started this
 * is long gone by the time anyone asks how it went.
 *
 * Colons separate them because none of the three can contain one: a build id
 * is a uuid, a service name is DNS-safe, and a tag is one of Cira's own ids.
 */
export function deploymentHandle(args: {
  buildId: string;
  service: string;
  tag: string;
}): string {
  return `${args.buildId}:${args.service}:${args.tag}`;
}

export interface DeploymentHandle {
  buildId: string;
  service: string;
  tag: string;
}

export function parseHandle(handle: string): DeploymentHandle {
  const [buildId, service, tag, ...rest] = handle.split(":");
  if (
    buildId === undefined ||
    service === undefined ||
    tag === undefined ||
    rest.length > 0 ||
    buildId === "" ||
    service === "" ||
    tag === ""
  ) {
    // Reachable: a row written by the Vercel provider holds a bare Vercel id,
    // and saying so beats a confusing failure against a build that never was.
    throw new Error("That deployment was not made by Cloud Run.");
  }
  return { buildId, service, tag };
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
