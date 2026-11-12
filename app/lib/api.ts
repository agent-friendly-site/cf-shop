/** Shared fetch helpers for admin/upload islands. No business rules. */

export type ApiError = { error?: string };

export async function parseJson<T>(res: Response): Promise<T & ApiError> {
  try {
    return (await res.json()) as T & ApiError;
  } catch {
    return { error: "服务器返回了无法解析的响应" } as T & ApiError;
  }
}

export async function adminFetch(shop: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`/shops/${shop}/admin/api${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
}

export function adminErrorMessage(data: ApiError, fallback: string) {
  return data.error || fallback;
}
