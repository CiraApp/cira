// Restore drill: put Cira's database back to a past moment on a NEW branch,
// prove the copy is that moment and not another, time it, and delete it.
//
//   NEON_PROJECT_ID=<id> node scripts/restore-drill.mjs
//
// Needs the Neon CLI signed in (`neonctl auth`). Production is only ever read:
// this never restores in place - docs/restore.md says how to do that for real.
// No connection string or password is printed.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

const PROJECT = process.env.NEON_PROJECT_ID;
if (!PROJECT) throw new Error("Set NEON_PROJECT_ID to Cira's Neon project.");

/** A line of the report, which is the point of running this. */
const say = (line = "") => process.stdout.write(`${line}\n`);
const neon = (args) =>
  execFileSync("neonctl", [...args, "--project-id", PROJECT], { encoding: "utf8" });
const uriFor = (branch) =>
  neon([
    "connection-string",
    branch,
    "--role-name",
    "neondb_owner",
    "--database-name",
    "neondb",
  ]).trim();

async function query(uri, sql, params = []) {
  const client = new pg.Client({ connectionString: uri });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

const TABLES = [
  "users",
  "spaces",
  "memberships",
  "apps",
  "deployments",
  "invites",
  "teams",
  "team_members",
  "space_changes",
  "invocations",
];
const counts = async (uri) => {
  const out = {};
  for (const t of TABLES)
    out[t] = Number((await query(uri, `select count(*)::int n from ${t}`))[0].n);
  return out;
};

// 1. Production, read only: pick a moment between two change-record rows at
//    least two minutes apart, so the right answer on the copy is unambiguous.
const prod = uriFor("production");
const rows = await query(
  prod,
  `select id, kind, detail, created_at from space_changes order by created_at desc limit 40`,
);
let before, after;
for (let i = 0; i + 1 < rows.length; i++) {
  const newer = rows[i],
    older = rows[i + 1];
  if (newer.created_at - older.created_at >= 120_000) {
    before = older;
    after = newer;
    break;
  }
}
if (!before)
  throw new Error("no gap of two minutes in the recent record to restore into");
const target = new Date((before.created_at.getTime() + after.created_at.getTime()) / 2);
const retention = JSON.parse(
  neon(["projects", "get", PROJECT, "--output", "json"]),
).history_retention_seconds;
const ageMin = (Date.now() - target.getTime()) / 60000;
say(
  `target            ${target.toISOString()}  (${ageMin.toFixed(0)} min ago; retention ${retention / 3600} h)`,
);
say(
  `last row before   ${before.created_at.toISOString()}  ${before.kind}  ${before.detail ?? ""}`,
);
say(
  `first row after   ${after.created_at.toISOString()}  ${after.kind}  ${after.detail ?? ""}`,
);
const prodCounts = await counts(prod);

// 2. Restore to a new branch at that moment, and time it until it answers.
const name = `restore-drill-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
const t0 = Date.now();
neon([
  "branches",
  "create",
  "--name",
  name,
  "--parent",
  target.toISOString(),
  "--no-secrets",
  "--output",
  "json",
]);
const created = Date.now();
let copy, ready;
for (let i = 0; i < 60; i++) {
  try {
    copy = uriFor(name);
    await query(copy, "select 1");
    ready = Date.now();
    break;
  } catch {
    await sleep(2000);
  }
}
if (!ready) throw new Error("the restored branch never answered");
say(`\nbranch created    ${((created - t0) / 1000).toFixed(1)} s`);
say(`answering         ${((ready - t0) / 1000).toFixed(1)} s after asking`);

// 3. Is it the database as it was at that moment?
const has = async (id) =>
  (await query(copy, "select 1 from space_changes where id = $1", [id])).length === 1;
const newest = (
  await query(
    copy,
    "select created_at from space_changes order by created_at desc limit 1",
  )
)[0];
const checks = {
  "row before the moment is there": await has(before.id),
  "row after the moment is not": !(await has(after.id)),
  "nothing newer than the moment": newest.created_at <= target,
  "migrations match production":
    JSON.stringify(
      await query(copy, "select count(*)::int n from drizzle.__drizzle_migrations"),
    ) ===
    JSON.stringify(
      await query(prod, "select count(*)::int n from drizzle.__drizzle_migrations"),
    ),
};
const copyCounts = await counts(copy);
const verified = Date.now();
say(`verified          ${((verified - t0) / 1000).toFixed(1)} s after asking\n`);
for (const [k, v] of Object.entries(checks)) say(`${v ? "PASS" : "FAIL"}  ${k}`);
say("\ntable            production   restored copy");
for (const t of TABLES)
  say(
    `${t.padEnd(16)} ${String(prodCounts[t]).padStart(10)}   ${String(copyCounts[t]).padStart(13)}`,
  );

// 4. Take the copy away again.
neon(["branches", "delete", name]);
const left = JSON.parse(neon(["branches", "list", "--output", "json"])).map(
  (b) => b.name,
);
say(`\ndeleted ${name}; branches now: ${left.join(", ")}`);
if (Object.values(checks).includes(false)) process.exit(1);
