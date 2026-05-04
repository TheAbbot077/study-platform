import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBackendBaseUrl() {
  const explicitServerApiBaseUrl = process.env.NEXT_SERVER_API_BASE_URL?.replace(
    /\/$/,
    ""
  );

  if (explicitServerApiBaseUrl) {
    return explicitServerApiBaseUrl;
  }

  const internalApiHostport = process.env.INTERNAL_API_HOSTPORT;
  if (internalApiHostport) {
    return `http://${internalApiHostport}`;
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:8000";
  }

  throw new Error("Server API base URL is not configured.");
}

function buildUpstreamUrl(request: NextRequest, path: string[]) {
  const requestUrl = new URL(request.url);
  const normalizedPath = path.join("/");
  const suffix = normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`;

  return `${getBackendBaseUrl()}/api/${suffix}${requestUrl.search}`;
}

function buildUpstreamHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);

  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  return headers;
}

async function proxyRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const upstreamUrl = buildUpstreamUrl(request, path);
  const headers = buildUpstreamHeaders(request);

  const requestInit: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (!["GET", "HEAD"].includes(request.method)) {
    requestInit.body = request.body;
  }

  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(upstreamUrl, requestInit);
  } catch {
    return Response.json(
      {
        detail:
          "Could not reach the API service from the frontend server.",
      },
      { status: 502 }
    );
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const OPTIONS = proxyRequest;
export const HEAD = proxyRequest;
