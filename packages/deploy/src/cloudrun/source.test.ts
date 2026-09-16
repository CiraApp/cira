import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleTokens } from "./auth.js";
import type { CloudRunConfig } from "./config.js";
import { SourceError, SourceStore } from "./source.js";

const config = {
  projectId: "proj",
  projectNumber: "1",
  region: "us-central1",
  sourceBucket: "cira-sources",
  artifactRepo: "cira-apps",
  serviceAccountEmail: "deployer@proj.iam.gserviceaccount.com",
  poolId: "vercel",
  providerId: "vercel",
} satisfies CloudRunConfig;

const tokens = { accessToken: async () => "ya29.fake" } as unknown as GoogleTokens;

function store(respond: (url: string, init?: RequestInit) => Response): SourceStore {
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) =>
    Promise.resolve(respond(String(input), init)),
  );
  return new SourceStore(config, tokens);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createUpload", () => {
  it("hands back the session Google opened", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;

    const ticket = await store((url, init) => {
      seen = { url, headers: init?.headers as Record<string, string> };
      return new Response("{}", {
        status: 200,
        headers: { location: "https://storage.googleapis.com/upload/session/abc" },
      });
    }).createUpload({ userId: "usr_1", sourceId: "src_2", size: 4096 });

    expect(ticket.uploadUrl).toBe("https://storage.googleapis.com/upload/session/abc");
    expect(ticket.sourceId).toBe("src_2");

    const call = seen as unknown as { url: string; headers: Record<string, string> };
    expect(call.url).toContain("uploadType=resumable");
    // The object name is one query parameter, so its slashes have to be escaped
    // or the bucket sees a different name than the one that gets read back.
    expect(call.url).toContain("name=sources%2Fusr_1%2Fsrc_2.tar.gz");

    // Declared up front so Google rejects a body of a different length itself.
    expect(call.headers["x-upload-content-length"]).toBe("4096");
    expect(call.headers["x-upload-content-type"]).toBe("application/gzip");
  });

  it("refuses a session with nowhere to send the bytes", async () => {
    await expect(
      store(() => new Response("{}", { status: 200 })).createUpload({
        userId: "usr_1",
        sourceId: "src_2",
        size: 1,
      }),
    ).rejects.toThrow(SourceError);
  });

  it("does not pass Google's own wording through", async () => {
    await expect(
      store(
        () => new Response("bucket cira-sources denied to deployer@...", { status: 403 }),
      ).createUpload({ userId: "usr_1", sourceId: "src_2", size: 1 }),
    ).rejects.toThrow("Google would not accept an upload (403).");
  });
});

describe("find", () => {
  it("reads the size and generation Google sends as strings", async () => {
    const found = await store(
      () =>
        new Response(JSON.stringify({ size: "12345", generation: "1700000000000001" }), {
          status: 200,
        }),
    ).find({ userId: "usr_1", sourceId: "src_2" });

    expect(found).toEqual({
      bucket: "cira-sources",
      object: "sources/usr_1/src_2.tar.gz",
      size: 12345,
      generation: "1700000000000001",
    });
  });

  // An upload that never finished is a normal thing to have happened, and the
  // caller turns it into a sentence about the deploy rather than an exception.
  it("is null when the upload never landed", async () => {
    const found = await store(() => new Response("", { status: 404 })).find({
      userId: "usr_1",
      sourceId: "src_2",
    });
    expect(found).toBeNull();
  });

  it("refuses a description it cannot read", async () => {
    await expect(
      store(() => new Response(JSON.stringify({ size: "12" }), { status: 200 })).find({
        userId: "usr_1",
        sourceId: "src_2",
      }),
    ).rejects.toThrow(SourceError);
  });
});
