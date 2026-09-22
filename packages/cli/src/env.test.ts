import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectEnv, isPublicName, parseDotenv } from "./env";

describe("parseDotenv", () => {
  it("reads plain pairs", () => {
    expect(parseDotenv("A=1\nB=two")).toEqual({ A: "1", B: "two" });
  });

  it("ignores comments and blank lines", () => {
    expect(parseDotenv("# a note\n\nA=1\n   \n# another\nB=2")).toEqual({
      A: "1",
      B: "2",
    });
  });

  it("accepts an export prefix", () => {
    expect(parseDotenv("export KEY=value")).toEqual({ KEY: "value" });
  });

  it("strips quotes that wrap the whole value", () => {
    expect(parseDotenv(`A="hello world"\nB='single'`)).toEqual({
      A: "hello world",
      B: "single",
    });
  });

  it("keeps quotes that are part of the value", () => {
    expect(parseDotenv(`A=say "hi"`)).toEqual({ A: 'say "hi"' });
  });

  it("keeps equals signs inside a value", () => {
    // Base64 and connection strings are full of them; splitting on every one
    // would quietly truncate a working credential.
    expect(parseDotenv("URL=postgres://u:p@h/db?a=1&b=2")).toEqual({
      URL: "postgres://u:p@h/db?a=1&b=2",
    });
    expect(parseDotenv("TOKEN=abc==")).toEqual({ TOKEN: "abc==" });
  });

  it("skips names a shell would not accept", () => {
    expect(parseDotenv("9LEADING=x\nhas-dash=x\nhas space=x\nOK=1")).toEqual({ OK: "1" });
  });

  it("skips lines with no assignment", () => {
    expect(parseDotenv("JUST_A_WORD\n=novalue\nA=1")).toEqual({ A: "1" });
  });

  it("is empty for an empty file", () => {
    expect(parseDotenv("")).toEqual({});
  });

  it("reads a double-quoted value across lines, the way a private key is kept", () => {
    const text = 'KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\nNEXT=1';
    expect(parseDotenv(text)).toEqual({
      KEY: "-----BEGIN KEY-----\nabc\n-----END KEY-----",
      NEXT: "1",
    });
  });

  it("turns \\n into a newline inside double quotes only", () => {
    expect(parseDotenv("A=\"one\\ntwo\"\nB='one\\ntwo'")).toEqual({
      A: "one\ntwo",
      B: "one\\ntwo",
    });
  });

  it("leaves a trailing comment out of an unquoted value", () => {
    expect(parseDotenv("PORT=8080 # the default\nHASH=abc#def")).toEqual({
      PORT: "8080",
      HASH: "abc#def",
    });
  });
});

describe("isPublicName", () => {
  it("knows which names the build publishes to the browser", () => {
    expect(isPublicName("NEXT_PUBLIC_API_URL")).toBe(true);
    expect(isPublicName("DATABASE_URL")).toBe(false);
    // Close but not the prefix - Next.js requires the trailing underscore - so
    // it stays server-side. Calling it public would be a false alarm, and false
    // alarms are how a warning stops being read.
    expect(isPublicName("NEXT_PUBLICITY")).toBe(false);
    expect(isPublicName("MY_NEXT_PUBLIC_X")).toBe(false);
  });
});

describe("collectEnv", () => {
  const scratch = (): string => mkdtempSync(join(tmpdir(), "cira-env-"));

  it("layers the files the way a production build reads them", () => {
    const root = scratch();
    writeFileSync(join(root, ".env"), "SHARED=env\nFROM=env");
    writeFileSync(join(root, ".env.production"), "FROM=production");
    writeFileSync(join(root, ".env.local"), "FROM=local\nLOCAL_ONLY=1");

    // Each overrides the one before, and nothing in an earlier file is lost
    // for being overridden elsewhere - reading only the first file that
    // existed used to drop everything in `.env`.
    const collected = collectEnv(root, []);
    expect(collected.env).toEqual({ SHARED: "env", FROM: "local", LOCAL_ONLY: "1" });
    expect(collected.source).toBe(".env, .env.production, .env.local");
    // A value typed at the prompt goes into the most specific file read.
    expect(collected.file).toBe(".env.local");
  });

  it("takes an explicit file over any candidate", () => {
    const root = scratch();
    writeFileSync(join(root, ".env.local"), "FROM=local");
    writeFileSync(join(root, "other.env"), "FROM=other");

    const collected = collectEnv(root, ["--env-file", "other.env"]);
    expect(collected.env).toEqual({ FROM: "other" });
    expect(collected.source).toBe("other.env");
  });

  it("fails loudly when the named file is missing", () => {
    // Silently deploying with no variables because a path was mistyped is how
    // an app goes live without its database.
    expect(() => collectEnv(scratch(), ["--env-file", "nope.env"])).toThrow(/nope\.env/);
  });

  it("lets an explicit pair override a file", () => {
    const root = scratch();
    writeFileSync(join(root, ".env.local"), "KEY=fromfile\nOTHER=kept");

    const collected = collectEnv(root, ["--env", "KEY=override"]);
    expect(collected.env).toEqual({ KEY: "override", OTHER: "kept" });
  });

  it("takes repeated pairs", () => {
    const collected = collectEnv(scratch(), ["--env", "A=1", "--env", "B=2"]);
    expect(collected.env).toEqual({ A: "1", B: "2" });
  });

  it("reads no files and sends no values when told to", () => {
    const root = scratch();
    writeFileSync(join(root, ".env.local"), "KEY=value");

    // Sending nothing now changes nothing: production keeps what it has.
    const collected = collectEnv(root, ["--no-env", "--env", "A=1"]);
    expect(collected.env).toEqual({});
    expect(collected.source).toBeNull();
  });

  it("takes a variable away only when asked, and never one it is also setting", () => {
    const collected = collectEnv(scratch(), [
      "--unset",
      "OLD_FLAG",
      "--unset=LEGACY_URL",
      "--env",
      "LEGACY_URL=kept",
    ]);
    expect(collected.unset).toEqual(["OLD_FLAG"]);
    expect(collected.env).toEqual({ LEGACY_URL: "kept" });
  });

  it("reads flags written with an equals sign", () => {
    const root = scratch();
    writeFileSync(join(root, "other.env"), "FROM=other");
    expect(collectEnv(root, ["--env-file=other.env"]).env).toEqual({ FROM: "other" });
  });

  it("is empty and sourceless when there is no file", () => {
    const collected = collectEnv(scratch(), []);
    expect(collected.env).toEqual({});
    expect(collected.source).toBeNull();
  });

  it("names the variables the build will publish", () => {
    const root = scratch();
    writeFileSync(
      join(root, ".env.local"),
      "SECRET=x\nNEXT_PUBLIC_URL=https://a\nNEXT_PUBLIC_ID=b",
    );

    expect(collectEnv(root, []).publicNames).toEqual([
      "NEXT_PUBLIC_ID",
      "NEXT_PUBLIC_URL",
    ]);
  });
});
