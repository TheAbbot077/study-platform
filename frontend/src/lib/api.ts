function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.substring(name.length + 1));
    }
  }

  return null;
}

let cachedCsrfToken: string | null = null;

const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const isLocalBrowser =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");
const shouldPreferSameOriginProxy =
  typeof window !== "undefined" && !isLocalBrowser;
const API_BASE_URL =
  shouldPreferSameOriginProxy
    ? ""
    : configuredApiBaseUrl === undefined
    ? isLocalBrowser
      ? "http://localhost:8000"
      : ""
    : configuredApiBaseUrl.replace(/\/$/, "");

function isCrossOriginApiBaseUrl() {
  if (typeof window === "undefined" || !API_BASE_URL) {
    return false;
  }

  try {
    const apiOrigin = new URL(API_BASE_URL, window.location.origin).origin;
    return apiOrigin !== window.location.origin;
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function parseErrorPayload(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    if (payload.trim().startsWith("<!DOCTYPE html")) {
      return null;
    }

    return payload.trim() || null;
  }

  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const directKeys = ["error", "detail", "message", "non_field_errors"];

    for (const key of directKeys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }

      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first === "string" && first.trim()) {
          return first.trim();
        }
      }
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first === "string" && first.trim()) {
          return first.trim();
        }
      }
    }
  }

  return null;
}

function buildApiErrorMessage(status: number, payload: unknown): string {
  const extracted = extractErrorMessage(payload);
  if (extracted) {
    return extracted;
  }

  if (status === 401 || status === 403) {
    return "Your session has expired or you do not have permission for that action. Please sign in again and retry.";
  }

  if (status === 404) {
    return "We could not find what you were looking for.";
  }

  if (status >= 500) {
    return "The server hit a problem while processing your request. Please try again in a moment.";
  }

  return "Something went wrong while contacting the server. Please try again.";
}

export function getDisplayErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (error instanceof ApiError) {
    return error.message || fallbackMessage;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallbackMessage;
}

export async function ensureCsrfCookie() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/accounts/csrf/`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to initialize CSRF protection.");
    }

    const payload = await response.json().catch(() => null);
    if (
      payload &&
      typeof payload === "object" &&
      typeof (payload as { csrfToken?: unknown }).csrfToken === "string"
    ) {
      cachedCsrfToken = (payload as { csrfToken: string }).csrfToken;
    }
  } catch {
    throw new Error(
      "Could not reach the server. Please check that the app and API are deployed and try again."
    );
  }
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const isFormData = options.body instanceof FormData;
  const method = (options.method || "GET").toUpperCase();
  const needsCsrf =
    !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method);
  const useCookieCsrf = !isCrossOriginApiBaseUrl();
  let csrfToken =
    needsCsrf && useCookieCsrf
      ? getCookie("csrftoken") || cachedCsrfToken
      : needsCsrf
      ? cachedCsrfToken
      : null;

  if (needsCsrf && (!csrfToken || isCrossOriginApiBaseUrl())) {
    await ensureCsrfCookie();
    csrfToken = useCookieCsrf
      ? getCookie("csrftoken") || cachedCsrfToken
      : cachedCsrfToken;
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${url}`, {
      credentials: "include",
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(csrfToken ? { "X-CSRFToken": csrfToken } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch {
    throw new Error(
      "Could not reach the server. Please check that the app and API are deployed and try again."
    );
  }

  const text = await response.text();

  if (!response.ok) {
    const payload = parseErrorPayload(text);
    throw new ApiError(
      buildApiErrorMessage(response.status, payload),
      response.status,
      payload
    );
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The server returned an unexpected response format.");
  }
}
