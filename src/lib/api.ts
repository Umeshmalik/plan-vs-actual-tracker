/** THE client-side call: the error envelope is parsed in exactly one place. */
"use client";

export interface ApiError {
  code: string;
  message: string;
  details?: { month?: string; issues?: { path: string; message: string }[] } & Record<string, unknown>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return {
      ok: false,
      error: { code: "NETWORK", message: "Could not reach the server. Check your connection and retry." },
    };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      error: body?.error ?? {
        code: "INTERNAL",
        message: "Something went wrong. Retry, and contact support if it persists.",
      },
    };
  }
  return { ok: true, data: body as T };
}

/** Field-level issues from a VALIDATION_FAILED envelope, keyed by field name. */
export function fieldErrors(error: ApiError | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error?.details?.issues ?? []) out[i.path] = i.message;
  return out;
}
