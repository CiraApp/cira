# Restoring Cira's database

Cira's own data - companies, people, apps, deploys, grants, the change record -
lives in one Neon Postgres project, on the branch `production`. Neon keeps its
history, so the database can be put back to any moment inside the retention
window. This is how, and what happened the one time it was tried.

## What can be restored, and how far back

Neon keeps **6 hours** of history on the plan Cira is on (the project's
`history_retention_seconds` is 21600). A mistake noticed in the evening, made
that morning, cannot be undone. Moving the Neon organisation to a paid plan
(roadmap 3.4) raises this to days, and is the single biggest improvement to
this document.

This covers Cira's own database only. Each app's database is its own Neon
project with its own history (lib/app-databases.ts); restoring one is the same
procedure against that project.

## Rehearse it: the drill

```sh
NEON_PROJECT_ID=<Cira's project> node scripts/restore-drill.mjs
```

Needs the Neon CLI signed in. It never touches `production` except to read:

1. Picks a moment between two rows of the change record at least two minutes
   apart, so the right answer is known in advance.
2. Creates a new branch at that moment and times how long until it answers.
3. Checks it is that moment and no other: the row just before is there, the
   row just after is not, nothing is newer, and the schema matches.
4. Deletes the branch.

Run it after anything that changes how the database is hosted, and every
quarter otherwise.

### 2026-09-23

Restored to 05:36:42 UTC, 49 minutes back. The branch existed in 1.2 seconds,
answered in 2.6, and was verified in 6.5. All four checks passed; every table
matched production except `space_changes`, which had the two rows written
after the moment and the copy correctly did not. Run twice, from the scratchpad
and then from the committed script, with the same result.

## Doing it for real

Decide first whether the whole database should go back, or only some rows.
Putting everything back also undoes every good change made since, by everyone,
in every company.

**Only some rows back** (someone deleted a team, a grant was removed): restore
to a new branch exactly as the drill does, copy the rows needed from it into
`production`, then delete the branch. Nothing else moves.

**Everything back** (a bad migration, data corrupted broadly):

1. Stop writes: in Vercel, pause the deployment or put Cira into maintenance,
   so nothing lands on the database mid-restore.
2. Note the moment to restore to, in UTC, just before the damage. The change
   record and Vercel's logs are the usual way to find it.
3. Restore in place, keeping what was there under another name:

   ```sh
   neonctl branches restore production ^self@2026-09-23T05:36:42Z \
     --preserve-under-name production-before-restore \
     --project-id <Cira's project>
   ```

   The connection string does not change, so Vercel needs nothing new.

4. If the damage came from a migration, revert the commit that added it before
   anything deploys again: CI migrates on every deploy and would apply it again.
5. Check Cira by signing in and opening an app, then resume writes.
6. Once satisfied, delete `production-before-restore`. It holds everything
   written after the moment, which is what to go back to if the restore was the
   wrong call.

Every step here is Neon's own API; none of it needs Cira to be running.
