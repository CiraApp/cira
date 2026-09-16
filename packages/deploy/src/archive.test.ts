import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArchiveError, tarGzip, type ArchiveEntry, tarUngzip } from "./archive.js";

const file = (path: string, body: string, mode = 0o644): ArchiveEntry => ({
  path,
  mode,
  body: Buffer.from(body, "utf8"),
});

let scratch = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "cira-archive-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Writes the archive out and unpacks it with the real thing. */
function extract(archive: Buffer): string {
  const tarball = join(scratch, "source.tar.gz");
  writeFileSync(tarball, archive);
  const into = join(scratch, "out");
  mkdirSync(into, { recursive: true });
  // `-p` keeps the modes we wrote instead of filtering them through the
  // runner's umask, which is the only way to test the executable bit.
  execFileSync("tar", ["-xzpf", tarball, "-C", into], { stdio: "pipe" });
  return into;
}

function list(archive: Buffer): string[] {
  const tarball = join(scratch, "list.tar.gz");
  writeFileSync(tarball, archive);
  const out = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  return out.split("\n").filter((line) => line !== "");
}

// A path that cannot fit in the 100-byte name field, so it only survives the
// round trip if the prefix split is right.
const DEEP = `${"a".repeat(60)}/${"b".repeat(60)}/${"c".repeat(30)}.ts`;

describe("tarGzip, read back by GNU tar", () => {
  it("round-trips contents", () => {
    const root = extract(
      tarGzip([
        file("package.json", '{ "name": "demo" }\n'),
        file("src/index.ts", "export const x = 1;\n"),
        file("empty.txt", ""),
      ]),
    );

    expect(readFileSync(join(root, "package.json"), "utf8")).toBe('{ "name": "demo" }\n');
    expect(readFileSync(join(root, "src/index.ts"), "utf8")).toBe(
      "export const x = 1;\n",
    );
    expect(readFileSync(join(root, "empty.txt"), "utf8")).toBe("");
  });

  it("survives contents that are not a whole number of blocks", () => {
    // 512-byte records mean the interesting sizes are the ones either side of
    // a boundary, where the padding is either missed or added twice.
    const sizes = [1, 511, 512, 513, 1024, 5000];
    const entries = sizes.map((n) => file(`f${n}.bin`, "z".repeat(n)));
    const root = extract(tarGzip(entries));

    for (const n of sizes) {
      expect(readFileSync(join(root, `f${n}.bin`), "utf8")).toBe("z".repeat(n));
    }
  });

  it("keeps a long path whole rather than truncating it", () => {
    const archive = tarGzip([file(DEEP, "deep\n")]);

    expect(list(archive)).toEqual([DEEP]);
    expect(readFileSync(join(extract(archive), DEEP), "utf8")).toBe("deep\n");
  });

  it("carries the executable bit, and nothing else about the mode", () => {
    const root = extract(
      tarGzip([
        file("start.sh", "#!/bin/sh\n", 0o755),
        file("group-run.sh", "#!/bin/sh\n", 0o764),
        file("notes.md", "hi\n", 0o644),
        // A private file from a checkout that had opinions about umask. What
        // reaches the build is the ordinary mode, not that one.
        file("secretive.txt", "hi\n", 0o600),
      ]),
    );

    expect(statSync(join(root, "start.sh")).mode & 0o777).toBe(0o755);
    expect(statSync(join(root, "group-run.sh")).mode & 0o777).toBe(0o755);
    expect(statSync(join(root, "notes.md")).mode & 0o777).toBe(0o644);
    expect(statSync(join(root, "secretive.txt")).mode & 0o777).toBe(0o644);
  });

  it("reads clean, with nothing for tar to complain about", () => {
    // tar warns about a malformed tail - a lone zero block, an unexpected EOF
    // - on stderr and still exits zero, so the warnings are the assertion.
    const tarball = join(scratch, "quiet.tar.gz");
    writeFileSync(tarball, tarGzip([file("a.txt", "a\n"), file("b/c.txt", "c\n")]));
    const run = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("a.txt\nb/c.txt\n");
  });

  it("lists entries in sorted order whatever order they arrived in", () => {
    expect(
      list(tarGzip([file("z.txt", "z"), file("a/b.txt", "b"), file("a.txt", "a")])),
    ).toEqual(["a.txt", "a/b.txt", "z.txt"]);
  });
});

describe("tarGzip determinism", () => {
  const entries = [
    file("src/index.ts", "export const x = 1;\n"),
    file("start.sh", "#!/bin/sh\n", 0o755),
    file(DEEP, "deep\n"),
    file("package.json", '{ "name": "demo" }\n'),
  ];

  it("gives the same bytes for the same input", () => {
    // A redeploy of unchanged source should be visibly unchanged, so nothing
    // that varies per run - a timestamp, a uid, a username - may reach the
    // archive.
    expect(tarGzip(entries).equals(tarGzip(entries))).toBe(true);
  });

  it("does not care what order the files were found in", () => {
    const reversed = [...entries].reverse();
    expect(tarGzip(entries).equals(tarGzip(reversed))).toBe(true);
  });

  it("ends on tar's own record boundary", () => {
    const tar = gunzipSync(tarGzip(entries));
    expect(tar.length % 10240).toBe(0);
    expect(tar.subarray(tar.length - 1024).every((byte) => byte === 0)).toBe(true);
  });
});

describe("tarGzip refusals", () => {
  it("refuses an absolute path", () => {
    expect(() => tarGzip([file("/etc/passwd", "x")])).toThrow(ArchiveError);
    expect(() => tarGzip([file("/etc/passwd", "x")])).toThrow("/etc/passwd");
  });

  it("refuses a path that climbs out of the project", () => {
    for (const path of ["../outside.txt", "src/../../outside.txt", "a/../b"]) {
      expect(() => tarGzip([file(path, "x")])).toThrow(ArchiveError);
    }
  });

  it("refuses an empty path", () => {
    expect(() => tarGzip([file("", "x")])).toThrow(ArchiveError);
  });

  it("refuses an empty path segment", () => {
    for (const path of ["src//index.ts", "src/"]) {
      expect(() => tarGzip([file(path, "x")])).toThrow(ArchiveError);
    }
  });

  it("refuses two entries for the same path", () => {
    const clash = tarGzip.bind(null, [file("a.txt", "one"), file("a.txt", "two")]);
    expect(clash).toThrow(ArchiveError);
    expect(clash).toThrow("a.txt");
  });

  it("refuses a path that will not fit, naming it", () => {
    // The final component alone is over the 100-byte name field, so there is
    // no separator to split on that would help.
    const path = `dir/${"x".repeat(120)}.ts`;
    expect(() => tarGzip([file(path, "x")])).toThrow(ArchiveError);
    expect(() => tarGzip([file(path, "x")])).toThrow(path);
  });

  it("refuses a path longer than the two fields together", () => {
    const path = `${"a".repeat(150)}/${"b".repeat(150)}/c.ts`;
    expect(() => tarGzip([file(path, "x")])).toThrow(ArchiveError);
  });
});

describe("tarUngzip", () => {
  const entries = [
    { path: "app/main.py", mode: 0o644, body: Buffer.from("print('hi')\n") },
    { path: "bin/run", mode: 0o755, body: Buffer.from("#!/bin/sh\n") },
    { path: "README.md", mode: 0o644, body: Buffer.from("# hello\n") },
  ];

  it("reads back exactly what was written", () => {
    const read = tarUngzip(tarGzip(entries));
    expect(read.map((e) => e.path)).toEqual(["README.md", "app/main.py", "bin/run"]);
    expect(read.map((e) => e.body.toString())).toEqual([
      "# hello\n",
      "print('hi')\n",
      "#!/bin/sh\n",
    ]);
  });

  it("keeps the executable bit", () => {
    const read = tarUngzip(tarGzip(entries));
    const run = read.find((e) => e.path === "bin/run");
    expect(run?.mode & 0o111).toBeTruthy();
  });

  // The prefix split is the part most likely to be wrong in either direction,
  // and a path that survives the writer but not the reader would be a file
  // silently missing from an analysis.
  it("round-trips a path long enough to need the prefix field", () => {
    const deep = `${"nested/".repeat(14)}module.py`;
    expect(deep.length).toBeGreaterThan(100);
    const read = tarUngzip(
      tarGzip([{ path: deep, mode: 0o644, body: Buffer.from("x") }]),
    );
    expect(read[0]?.path).toBe(deep);
  });

  it("handles an empty file and a file crossing a block boundary", () => {
    const odd = [
      { path: "empty.txt", mode: 0o644, body: Buffer.alloc(0) },
      { path: "big.txt", mode: 0o644, body: Buffer.alloc(1025, 0x61) },
    ];
    const read = tarUngzip(tarGzip(odd));
    expect(read.find((e) => e.path === "empty.txt")?.body.length).toBe(0);
    expect(read.find((e) => e.path === "big.txt")?.body.length).toBe(1025);
  });

  // Written by real GNU tar rather than by us, because an archive we both
  // wrote and read proves only that we are consistent with ourselves.
  it("reads an archive GNU tar produced", () => {
    const dir = mkdtempSync(join(tmpdir(), "cira-untar-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "a.go"), "package main\n");
      writeFileSync(join(dir, "go.mod"), "module x\n");
      const out = join(dir, "out.tar.gz");
      execFileSync("tar", ["-czf", out, "-C", dir, "src/a.go", "go.mod"]);

      const read = tarUngzip(readFileSync(out));
      const paths = read.map((e) => e.path).sort();
      expect(paths).toEqual(["go.mod", "src/a.go"]);
      expect(read.find((e) => e.path === "go.mod")?.body.toString()).toBe("module x\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses something that is not an archive", () => {
    expect(() => tarUngzip(Buffer.from("not a tarball"))).toThrow(ArchiveError);
  });
});
