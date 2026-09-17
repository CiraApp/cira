/**
 * What a project says about how to run itself.
 *
 * Cira builds with buildpacks, which work out a language from the source and
 * are why deploying stopped being a Next.js-only affair. What they cannot work
 * out is how to start something they did not recognise - and a great deal of
 * internal software already answers that question, in a Dockerfile, which Cira
 * was ignoring. Wave's build got as far as installing 53 packages and then
 * failed for want of an entrypoint that was written down two directories away.
 *
 * So: a Dockerfile wins when there is one. Its author knew.
 */

export interface ContainerSpec {
  /**
   * The port the image says it listens on, or null when it does not say.
   *
   * This matters more than it looks. Cloud Run routes to whatever port the
   * service names and sets `PORT` in the container to match, so a Dockerfile
   * that hardcodes 8000 is correct if Cira says 8000 and unreachable if Cira
   * assumes 8080. Reading it is how an image that never heard of Cloud Run
   * still works on it.
   */
  port: number | null;
}

/** Cloud Run's own default, used when an image does not say. */
export const DEFAULT_CONTAINER_PORT = 8080;

/**
 * Read a Dockerfile for the little Cira needs from it.
 *
 * Only `EXPOSE`, and only the first one: an image exposing several ports is
 * telling you about more than the one thing Cloud Run can route to, and
 * guessing which is worse than using the default.
 */
export function readDockerfile(text: string): ContainerSpec {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!/^expose\s/i.test(line)) continue;

    // `EXPOSE 8000`, `EXPOSE 8000/tcp`, `EXPOSE 8000 9000`. A port given as a
    // build argument - `EXPOSE ${PORT}` - is not a number and is left alone.
    const first = line.slice("expose".length).trim().split(/\s+/)[0] ?? "";
    const port = Number.parseInt(first.split("/")[0] ?? "", 10);

    if (Number.isInteger(port) && port > 0 && port < 65536) return { port };
    return { port: null };
  }

  return { port: null };
}

/** Whether a path is the Dockerfile a build would use, rather than one beside it. */
export function isRootDockerfile(path: string): boolean {
  return path === "Dockerfile";
}
