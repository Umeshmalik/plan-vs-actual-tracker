"use client";

/**
 * useApiMutation — THE mutation. Every write in the app goes through here, so
 * the error envelope is parsed once, the toast wording is applied once, and the
 * server tree is refreshed once. A screen supplies the URL, the method and the
 * success sentence; it never touches fetch, pending flags or router.refresh.
 */
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, type ApiError } from "./api";

/** Thrown so TanStack Query treats an error envelope as a failed mutation. */
export class ApiEnvelopeError extends Error {
  constructor(public envelope: ApiError) {
    super(envelope.message);
    this.name = "ApiEnvelopeError";
  }
}

type Msg<V> = string | ((vars: V) => string | null) | null;

function resolve<V>(msg: Msg<V>, vars: V): string | null {
  return typeof msg === "function" ? msg(vars) : msg;
}

export interface ApiMutationOptions<T, V> {
  /** Endpoint, or a function of the variables for path params. */
  url: string | ((vars: V) => string);
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Toast on success. `null` suppresses it — use when the screen already reports. */
  success?: Msg<V>;
  /** `false` keeps the server tree as-is (e.g. a preview that writes nothing). */
  refresh?: boolean;
  onDone?: (data: T, vars: V) => void;
}

export function useApiMutation<T, V = void>({
  url,
  method = "POST",
  success = null,
  refresh = true,
  onDone,
}: ApiMutationOptions<T, V>): UseMutationResult<T, ApiEnvelopeError, V> & { envelope: ApiError | null } {
  const router = useRouter();

  const mutation = useMutation<T, ApiEnvelopeError, V>({
    mutationFn: async vars => {
      // A function `url` means the variables ARE the path params (DELETE
      // /api/actuals/:id), so there is no body to send. A string url means the
      // variables are the body.
      const byPath = typeof url === "function";
      const res = await api<T>(byPath ? url(vars) : url, {
        method,
        body: byPath || vars === undefined ? undefined : JSON.stringify(vars),
      });
      if (!res.ok) throw new ApiEnvelopeError(res.error);
      return res.data;
    },
    onSuccess: (data, vars) => {
      const msg = resolve(success, vars);
      if (msg) toast.success(msg);
      if (refresh) router.refresh();
      onDone?.(data, vars);
    },
    // The server's wording, verbatim — one error vocabulary, end to end.
    onError: err => toast.error(err.envelope.message),
  });

  return { ...mutation, envelope: mutation.error?.envelope ?? null } as UseMutationResult<
    T,
    ApiEnvelopeError,
    V
  > & {
    envelope: ApiError | null;
  };
}
