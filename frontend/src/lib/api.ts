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

export async function ensureCsrfCookie() {
  await fetch("http://localhost:8000/api/accounts/csrf/", {
    method: "GET",
    credentials: "include",
  });
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const isFormData = options.body instanceof FormData;
  let csrfToken = getCookie("csrftoken");

  if (!csrfToken) {
    await ensureCsrfCookie();
    csrfToken = getCookie("csrftoken");
  }

  const response = await fetch(`http://localhost:8000${url}`, {
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(csrfToken ? { "X-CSRFToken": csrfToken } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${text}`);
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API returned non-JSON content: ${text}`);
  }
}