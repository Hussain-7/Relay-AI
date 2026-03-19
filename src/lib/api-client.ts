/**
 * Typed client-side API helpers.
 *
 * Usage:
 *   import { api } from "@/lib/api-client";
 *
 *   const data  = await api.get<{ user: User }>("/api/user");
 *   const data  = await api.post<{ conversation: Conv }>("/api/conversations", { id });
 *   const data  = await api.patch<{ conversation: Conv }>(`/api/conversations/${id}`, { title });
 *   await api.del(`/api/conversations/${id}`);
 *   const data  = await api.upload<{ attachment: Att }>("/api/uploads", formData);
 *   const response = await api.stream(`/api/conversations/${id}/messages`, body);
 */

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // ignore parse failures
  }
  return "Request failed.";
}

/** JSON request with error extraction — the core building block. */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export const api = {
  /** GET a JSON endpoint. */
  get<T>(url: string): Promise<T> {
    return fetchJson<T>(url);
  },

  /** POST JSON body. Returns parsed response. */
  post<T>(url: string, body?: unknown): Promise<T> {
    return fetchJson<T>(url, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  /** PATCH JSON body. Returns parsed response. */
  patch<T>(url: string, body: unknown): Promise<T> {
    return fetchJson<T>(url, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  /** PUT JSON body. Returns parsed response. */
  put<T>(url: string, body: unknown): Promise<T> {
    return fetchJson<T>(url, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  /** DELETE. Returns parsed response (usually `{ ok: true }`). */
  del<T = unknown>(url: string): Promise<T> {
    return fetchJson<T>(url, { method: "DELETE" });
  },

  /** Upload FormData (browser sets Content-Type with boundary automatically). */
  async upload<T>(url: string, formData: FormData): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<T>;
  },

  /**
   * POST that returns the raw Response for streaming (SSE).
   * Throws on non-2xx or missing body.
   */
  async stream(url: string, body: unknown): Promise<Response> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const message = await extractErrorMessage(response).catch(() => "Failed to start stream.");
      throw new ApiError(message, response.status);
    }

    return response;
  },
};

export { ApiError };
