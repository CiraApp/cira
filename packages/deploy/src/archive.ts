/**
 * Turning a project's files into the one thing Cloud Build will take.
 *
 * Cloud Build fetches a gzipped tar from Cloud Storage and unpacks it with
 * GNU tar, so the archive has to be right before anything else about a deploy
 * can be. It is built here by hand rather than with a tar library because this
 * file is bundled into the single-file CLI, which holds itself to no
 * third-party runtime dependencies - and ustar is a fixed 512-byte record
 * format from 1988 that is not going to move under us.
 *
 * The output is deterministic on purpose: identical source produces an
 * identical archive, byte for byte, so a redeploy of unchanged code is
 * visibly unchanged rather than merely claimed to be.
 */

import { gzipSync } from "node:zlib";

export interface ArchiveEntry {
  /** Path relative to the project root, `/`-separated, no leading slash. */
  path: string;
  /** Unix mode bits. Only the executable bit matters in practice. */
  mode: number;
  body: Buffer;
}

export class ArchiveError extends Error {}

const BLOCK = 512;

/**
 * GNU tar's default blocking factor is 20 records, and it pads every archive
 * it writes out to a multiple of that. Matching it means the archives we
 * produce look like the archives tar produces, which is one fewer difference
 * to reason about when a build fails at the unpacking step.
 */
const BLOCKING = 20 * BLOCK;

const NAME_MAX = 100;
const PREFIX_MAX = 155;

/** The largest file `size` fits in eleven octal digits: just under 8 GiB. */
const SIZE_MAX = 0o77777777777;

/** A gzipped tar of these files, as GNU tar and Cloud Build expect it. */
export function tarGzip(entries: readonly ArchiveEntry[]): Buffer {
  for (const entry of entries) checkPath(entry.path);

  const ordered = sortByPath(entries);
  rejectDuplicates(ordered);

  const blocks: Buffer[] = [];
  for (const entry of ordered) {
    if (entry.body.length > SIZE_MAX) {
      throw new ArchiveError(`${entry.path} is too large for a tar archive.`);
    }
    blocks.push(header(entry), pad(entry.body));
  }

  // Two zero blocks are the end-of-archive marker; the padding after them is
  // what makes the whole thing a whole number of tar records.
  blocks.push(Buffer.alloc(2 * BLOCK));
  const body = Buffer.concat(blocks);
  const trailing = (BLOCKING - (body.length % BLOCKING)) % BLOCKING;

  // Node's zlib writes a zero modification time into the gzip header unless
  // asked otherwise, and it is never asked otherwise here, so the compressed
  // bytes are as reproducible as the tar inside them.
  return gzipSync(Buffer.concat([body, Buffer.alloc(trailing)]), { level: 9 });
}

/**
 * Sorted by code unit rather than by locale. `localeCompare` would order the
 * same two paths differently on two machines, which is exactly the kind of
 * difference this file exists to avoid.
 */
function sortByPath(entries: readonly ArchiveEntry[]): ArchiveEntry[] {
  return [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function rejectDuplicates(ordered: readonly ArchiveEntry[]): void {
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (previous === undefined || current === undefined) continue;
    if (previous.path === current.path) {
      throw new ArchiveError(`${current.path} appears more than once in the archive.`);
    }
  }
}

/**
 * What a path has to be before it is safe to unpack somewhere we do not
 * control. An absolute path or one that climbs out with `..` writes outside
 * the build's working directory, and an empty segment - a trailing or doubled
 * slash - is a directory pretending to be a file.
 */
function checkPath(path: string): void {
  if (path === "") {
    throw new ArchiveError("An archive entry has an empty path.");
  }
  if (path.startsWith("/")) {
    throw new ArchiveError(`${path} is absolute; archive paths are relative.`);
  }
  const segments = path.split("/");
  if (segments.includes("..")) {
    throw new ArchiveError(`${path} escapes the project root.`);
  }
  if (segments.includes("")) {
    throw new ArchiveError(`${path} has an empty path segment.`);
  }
}

function header(entry: ArchiveEntry): Buffer {
  const { name, prefix } = split(entry.path);
  const block = Buffer.alloc(BLOCK);

  block.write(name, 0, NAME_MAX, "utf8");
  octal(block, normaliseMode(entry.mode), 100, 8);
  octal(block, 0, 108, 8); // uid
  octal(block, 0, 116, 8); // gid
  octal(block, entry.body.length, 124, 12);
  octal(block, 0, 136, 12); // mtime
  block.write("0", 156, 1, "ascii"); // typeflag: a regular file
  block.write("ustar", 257, 5, "ascii");
  block.write("00", 263, 2, "ascii");
  // uname and gname are left empty so the archive does not carry the name of
  // whoever's laptop it was built on; tar falls back to the numeric ids.
  octal(block, 0, 329, 8); // devmajor
  octal(block, 0, 337, 8); // devminor
  block.write(prefix, 345, PREFIX_MAX, "utf8");

  checksum(block);
  return block;
}

/**
 * Only the permission bits survive, and only the question they really answer:
 * is this thing meant to be run? Windows checkouts report modes that mean
 * nothing on Linux, and the one case that matters downstream is an entrypoint
 * script that has to be executable when Cloud Build reaches it.
 */
function normaliseMode(mode: number): number {
  return (mode & 0o777 & 0o111) !== 0 ? 0o755 : 0o644;
}

/**
 * ustar splits a long path across two fields, joined back with a `/`, so the
 * split has to land on a separator that is already there. Failing loudly is
 * the point: a truncated path would unpack to the wrong file rather than to
 * no file, and nobody would notice until production was serving it.
 */
function split(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= NAME_MAX) return { name: path, prefix: "" };

  // Deepest separator first, because that gives the shortest name, and name is
  // the tighter of the two fields.
  for (let at = path.lastIndexOf("/"); at > 0; at = path.lastIndexOf("/", at - 1)) {
    const prefix = path.slice(0, at);
    const name = path.slice(at + 1);
    if (name === "") continue;
    if (Buffer.byteLength(prefix) <= PREFIX_MAX && Buffer.byteLength(name) <= NAME_MAX) {
      return { name, prefix };
    }
  }

  throw new ArchiveError(`${path} is too long for a tar archive.`);
}

/** An octal number, left-padded with zeroes, with a NUL in the last byte. */
function octal(block: Buffer, value: number, offset: number, size: number): void {
  block.write(value.toString(8).padStart(size - 1, "0"), offset, size - 1, "ascii");
}

/**
 * The header's checksum is over the header itself, which cannot include the
 * checksum, so the field is counted as eight spaces while summing. The six
 * digits, NUL, space layout is what every tar since v7 writes and what every
 * reader expects, whatever the spec permits.
 */
function checksum(block: Buffer): void {
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  block[154] = 0;
  block[155] = 0x20;
}

/** File contents, rounded up to a whole number of blocks. */
function pad(body: Buffer): Buffer {
  const remainder = body.length % BLOCK;
  if (remainder === 0) return body;
  return Buffer.concat([body, Buffer.alloc(BLOCK - remainder)]);
}
