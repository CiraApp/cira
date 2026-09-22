import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tarGzip, type ArchiveEntry, type BundleFile } from "@cira/deploy/packaging";
import { api, ApiError } from "./api.js";

/**
 * Getting this folder to the build.
 *
 * The archive goes straight from here into Google's storage. It does not pass
 * through Cira, which asked Google to open the upload and said where to send
 * it but never sees a byte of the source. That is what lets a real project
 * deploy at all: Cira runs on a platform that caps a request body at a few
 * megabytes, and source funnelled through it could never exceed that.
 */

interface Ticket {
  sourceId: string;
  /**
   * Secret, and short-lived. Whoever holds this can write one object, so it is
   * used immediately and never written anywhere.
   */
  uploadUrl: string;
}

/**
 * Read the files and compress them, in memory - a bundle is capped at 100 MB.
 *
 * The entries come back alongside the archive because they are the only moment
 * the whole project is in hand as text. Reading it all a second time to look
 * for anything would be reading it all a second time.
 */
export function readEntries(root: string, files: readonly BundleFile[]): ArchiveEntry[] {
  return files.map((file) => {
    const full = join(root, file.path);
    // The mode is read here rather than carried from the walk, because the
    // only bit that survives into the archive is whether it is executable and
    // an entrypoint script that arrives without it will not run.
    return { path: file.path, mode: statSync(full).mode, body: readFileSync(full) };
  });
}

export function archiveProject(
  root: string,
  files: readonly BundleFile[],
): { archive: Buffer; entries: ArchiveEntry[] } {
  const entries = readEntries(root, files);
  return { archive: tarGzip(entries), entries };
}

/** Upload it, and return the name the deploy will ask to build. */
export async function uploadSource(archive: Buffer): Promise<string> {
  const ticket = await api<Ticket>("/api/cli/source", {
    method: "POST",
    body: { size: archive.byteLength },
  });

  // A stalled connection used to hang the deploy for good. The allowance is
  // generous - a minute, plus ten seconds a megabyte, so a slow line still
  // finishes - and one dropped attempt is tried again before giving up.
  const allowance = 60_000 + Math.ceil(archive.byteLength / 1_048_576) * 10_000;
  let response: Response | null = null;
  for (let attempt = 1; attempt <= 2 && response === null; attempt += 1) {
    try {
      response = await fetch(ticket.uploadUrl, {
        method: "PUT",
        // No authorization header, deliberately. The URL *is* the
        // authorisation: Cira obtained it as itself and delegated exactly this
        // one write. The CLI has no standing with Google and does not need any.
        headers: {
          "content-type": "application/gzip",
          "content-length": String(archive.byteLength),
        },
        body: new Uint8Array(archive),
        signal: AbortSignal.timeout(allowance),
      });
    } catch (error) {
      if (attempt === 2) {
        throw new ApiError(
          error instanceof Error && error.name === "TimeoutError"
            ? "The upload stalled and did not finish. Check the connection and deploy again."
            : "Could not reach storage to upload this project.",
          0,
        );
      }
    }
  }

  if (response === null || !response.ok) {
    const status = response?.status ?? 0;
    throw new ApiError(`The upload was rejected (${status}).`, status);
  }

  return ticket.sourceId;
}
