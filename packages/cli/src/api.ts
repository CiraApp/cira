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
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const config = readConfig();
  const token = options.token ?? config.token;

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(`Could not reach Cira at ${config.apiUrl}.`, 0);
  }

  if (response.status === 401) {
    throw new ApiError("You are not signed in. Run: cira login", 401);
  }

  if (!response.ok) {
    throw new ApiError(
      `Cira returned an error (${response.status}) for ${path}.`,
      response.status,
    );
  }

  return (await response.json()) as T;
}
