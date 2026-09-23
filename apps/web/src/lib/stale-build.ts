/**
 * Whether an error is this page having outlived the version of Cira it came
 * from, rather than anything being wrong.
 *
 * A page holds the ids of the server actions it was built with. Once a new
 * version is live those ids are gone, and the first button pressed on a page
 * opened before the deploy fails with "Server Action ... was not found on the
 * server". Nothing is broken and nothing needs reporting; the page needs the
 * new version, which only a reload gives it.
 */
export function isStaleBuild(error: { name?: string; message?: string }): boolean {
  return (
    error.name === "UnrecognizedActionError" ||
    /Server Action "?[\w-]*"? was not found on the server|Failed to find Server Action/i.test(
      error.message ?? "",
    )
  );
}

/**
 * Reload into the new version, at most once a minute, so a page that fails
 * the same way after reloading is shown rather than reloaded forever.
 * Storage can be unavailable; without it this reloads once and relies on the
 * page not failing again.
 */
export function reloadForNewBuild(now = Date.now()): boolean {
  const key = "cira:reloaded-for-build";
  try {
    const last = Number(window.sessionStorage.getItem(key) ?? "0");
    if (now - last < 60_000) return false;
    window.sessionStorage.setItem(key, String(now));
  } catch {
    // Private windows and blocked storage: reload anyway.
  }
  window.location.reload();
  return true;
}
