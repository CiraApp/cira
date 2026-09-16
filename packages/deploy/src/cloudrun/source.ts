/**
 * Getting a project's source to Google without it passing through Cira.
 *
 * Cira runs on Vercel, where a serverless function's request body is capped
 * around four and a half megabytes. Every byte of a customer's source used to
 * be funnelled through one of those functions, so a project larger than that
 * failed with an opaque 413 that named a limit Cira does not have. Raising
 * Cira's own limit could never have fixed it.
 *
 * So the bytes stop coming here at all. Cira asks Google to open a resumable
 * upload session, hands the CLI the session URI, and the CLI writes straight
 * into the bucket. The decision about *whether* someone may deploy still
 * happens on Cira; only the payload takes the short route.
 *
 * A resumable session URI is used rather than a signed URL for a specific
 * reason: signing needs either a service account key, which Google's policy
 * refuses to issue, or the `signBlob` permission, which would be another
 * grant to maintain. Opening a session needs nothing beyond the access token
 * Cira already holds, and the URI it returns delegates exactly the same
 * narrow right - write these bytes, to this one object, for a limited time.
 *
 * The URI is therefore a credential and is treated as one: it is returned to
 * the caller who asked for it and is never logged, in the same spirit as
 * docs/secrets.md.
 */

import { createHash } from "node:crypto";
import type { GoogleTokens } from "./auth.js";
import type { CloudRunConfig } from "./config.js";
import { sourceObject } from "./names.js";

const UPLOAD = "https://storage.googleapis.com/upload/storage/v1";
const STORAGE = "https://storage.googleapis.com/storage/v1";

/** What Cloud Build will be told it is unpacking. */
const CONTENT_TYPE = "application/gzip";

export interface UploadTicket {
  /** Names the upload in the deploy that follows. Not secret. */
  sourceId: string;
  /** Secret. Whoever holds it can write that one object. */
  uploadUrl: string;
  /** Bytes the session was opened for. Google rejects a different length. */
  size: number;
}

export interface StoredSource {
  bucket: string;
  object: string;
  size: number;
  /** Pins the build to these exact bytes, not to whatever the name holds later. */
  generation: string;
}

export class SourceError extends Error {}

export class SourceStore {
  constructor(
    private readonly config: CloudRunConfig,
    private readonly tokens: GoogleTokens,
  ) {}

  /**
   * Open a session the CLI can write one archive into.
   *
   * The length is declared up front so Google enforces it rather than Cira
   * having to, and so an upload that disagrees with what was authorised fails
   * at the bucket instead of becoming a build.
   */
  async createUpload(args: {
    userId: string;
    sourceId: string;
    size: number;
  }): Promise<UploadTicket> {
    const object = sourceObject(args.userId, args.sourceId);
    const access = await this.tokens.accessToken();

    const response = await fetch(
      `${UPLOAD}/b/${encodeURIComponent(this.config.sourceBucket)}/o` +
        `?uploadType=resumable&name=${encodeURIComponent(object)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": CONTENT_TYPE,
          "x-upload-content-length": String(args.size),
        },
        body: "{}",
      },
    );

    if (!response.ok) {
      throw new SourceError(`Google would not accept an upload (${response.status}).`);
    }

    const uploadUrl = response.headers.get("location");
    if (uploadUrl === null || uploadUrl === "") {
      throw new SourceError("Google opened an upload with nowhere to send it.");
    }

    return { sourceId: args.sourceId, uploadUrl, size: args.size };
  }

  /**
   * Fetch an archive back.
   *
   * Cira analyses what it was asked to deploy, and this is where it gets it:
   * the same bytes the build read, without a second upload or a copy kept
   * anywhere. Held in memory only for as long as it takes to read the source
   * out of it.
   */
  async download(source: StoredSource): Promise<Buffer> {
    const access = await this.tokens.accessToken();
    const response = await fetch(
      `${STORAGE}/b/${encodeURIComponent(source.bucket)}` +
        `/o/${encodeURIComponent(source.object)}?alt=media` +
        `&generation=${encodeURIComponent(source.generation)}`,
      { headers: { authorization: `Bearer ${access}` } },
    );

    if (!response.ok) {
      throw new SourceError(`Google would not return the upload (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Confirm an upload actually arrived, and pin the build to it.
   *
   * Called before a build is started, because the alternative is a build that
   * fails deep inside Cloud Build with a message about a missing object, for
   * what is really "your upload did not finish".
   *
   * The generation is carried forward so the build reads the bytes that were
   * checked here. Without it, a second upload to the same name between this
   * call and the build would be what actually got built.
   */
  async find(args: { userId: string; sourceId: string }): Promise<StoredSource | null> {
    const object = sourceObject(args.userId, args.sourceId);
    const access = await this.tokens.accessToken();

    const response = await fetch(
      `${STORAGE}/b/${encodeURIComponent(this.config.sourceBucket)}` +
        `/o/${encodeURIComponent(object)}`,
      { headers: { authorization: `Bearer ${access}` } },
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new SourceError(`Google would not describe the upload (${response.status}).`);
    }

    // `size` and `generation` are strings in the JSON API, not numbers, which
    // is easy to miss until a comparison against a number is quietly false.
    const body = (await response.json()) as { size?: unknown; generation?: unknown };
    const size = Number(body.size);
    if (!Number.isFinite(size) || typeof body.generation !== "string") {
      throw new SourceError("Google described the upload in a way Cira cannot read.");
    }

    return {
      bucket: this.config.sourceBucket,
      object,
      size,
      generation: body.generation,
    };
  }
}

/**
 * One archive, as a URI the rest of Cira can carry around without knowing what
 * it means. The generation is part of it on purpose: a URI naming only the
 * object would let a later upload to the same name become what gets built.
 */
export function archiveUri(source: StoredSource): string {
  return `gs://${source.bucket}/${source.object}#${source.generation}`;
}

export interface ParsedArchive {
  bucket: string;
  object: string;
  generation: string;
}

export function parseArchiveUri(uri: string): ParsedArchive {
  const match = /^gs:\/\/([^/]+)\/(.+)#(\d+)$/.exec(uri);
  const [, bucket, object, generation] = match ?? [];
  if (bucket === undefined || object === undefined || generation === undefined) {
    throw new SourceError("That deployment's source is not somewhere Cira can read.");
  }
  return { bucket, object, generation };
}

/**
 * The tag the image built from this source will carry.
 *
 * A hash of the URI rather than the source id read out of it, so that nothing
 * depends on how objects happen to be named, and so the result is always a
 * legal Docker tag whatever the name turns out to contain. Deterministic, so
 * building the same bytes twice addresses the same image.
 */
export function imageTag(uri: string): string {
  return createHash("sha256").update(uri, "utf8").digest("hex").slice(0, 16);
}
