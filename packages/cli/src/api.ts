import { readConfig } from "./config.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Talk to Cira.
 *
 * Network and HTTP failures are turned into one plain sentence: someone at a
 * terminal needs to know what to do next, not what the status code was.
 */
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    /** Send file bytes instead of JSON, addressed by hash. */
    raw?: { sha: string; body: Buffer };
  } = {},
): Promise<T> {
  const config = readConfig();
  const token = options.token ?? config.token;

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type":
          options.raw === undefined ? "application/json" : "application/octet-stream",
        ...(options.raw !== undefined ? { "x-cira-sha": options.raw.sha } : {}),
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(options.raw !== undefined
        ? { body: new Uint8Array(options.raw.body) }
        : options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
    });
  } catch {
    throw new ApiError(`Could not reach Cira at ${config.apiUrl}.`, 0);
  }

  if (response.status === 401) {
    throw new ApiError("You are not signed in. Run: cira login", 401);
  }

  if (!response.ok) {
    // Cira already knows what went wrong and says so in plain words. Throwing
    // away that sentence for a status code makes the CLI useless to debug.
    const said = await response
      .json()
      .then((body: unknown) =>
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : null,
      )
      .catch(() => null);

    throw new ApiError(
      said ?? `Cira returned an error (${response.status}).`,
      response.status,
    );
  }

  return (await response.json()) as T;
}
