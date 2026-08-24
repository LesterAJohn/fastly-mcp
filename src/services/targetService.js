const DEFAULT_TIMEOUT_MS = 15000;
export const FASTLY_API_BASE_URL = "https://api.fastly.com";

function joinUrl(baseUrl, path, query) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function parseResponseBody(contentType, text) {
  if (!text) {
    return null;
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}

export class FastlyServiceClient {
  constructor({
    baseUrl = FASTLY_API_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    authMode = "per-user-fastly-key"
    } = {}) {
    this.baseUrl = String(baseUrl ?? FASTLY_API_BASE_URL).trim();
    this.timeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    this.authMode = String(authMode ?? "per-user-fastly-key").toLowerCase();
  }

  getConnectionInfo() {
    return {
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      authMode: this.authMode,
      tokenSource: "request.fastlyToken or Vault-backed token resolver"
    };
  }

  listKnownEndpoints() {
    return [
      { method: "GET|POST|PUT|PATCH|DELETE", path: "/*", description: "All Fastly API endpoints through service_api_request" },
      { method: "GET", path: "/service", description: "List services" },
      { method: "GET", path: "/service/:service_id/version", description: "List service versions" },
      { method: "POST", path: "/service/:service_id/purge_all", description: "Purge all service content" },
      { method: "POST", path: "/purge/:surrogate_key", description: "Purge a surrogate key" }
    ];
  }

  async request({ method = "GET", path = "/", query, body, headers = {}, fastlyToken }) {
    if (!fastlyToken) throw Object.assign(new Error("A user-scoped Fastly API token is required"), { status: 401 });
    const upperMethod = String(method).toUpperCase();
    const url = joinUrl(this.baseUrl, path, query);
    const requestHeaders = {
      Accept: "application/json",
      "Fastly-Key": String(fastlyToken),
      ...headers
    };

    let payload;
    if (body !== undefined && body !== null && upperMethod !== "GET") {
      if (typeof body === "string") {
        payload = body;
      } else {
        payload = JSON.stringify(body);
        if (!requestHeaders["Content-Type"] && !requestHeaders["content-type"]) {
          requestHeaders["Content-Type"] = "application/json";
        }
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: upperMethod,
        headers: requestHeaders,
        body: payload,
        signal: controller.signal
      });

      const text = await response.text();
      const contentType = String(response.headers.get("content-type") ?? "");
      const parsed = parseResponseBody(contentType, text);

      if (!response.ok) {
        const error = new Error(`Target service request failed: ${upperMethod} ${url.pathname} -> ${response.status}`);
        error.status = response.status;
        error.response = parsed;
        throw error;
      }

      return {
        method: upperMethod,
        path: url.pathname,
        url: url.toString(),
        status: response.status,
        contentType,
        data: parsed
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(fastlyToken) {
    return this.request({ method: "GET", path: "/tokens/self", fastlyToken });
  }

  async listServices(fastlyToken) {
    return this.request({ path: "/service", fastlyToken });
  }

  async listVersions(serviceId, fastlyToken) {
    return this.request({ path: `/service/${encodeURIComponent(serviceId)}/version`, fastlyToken });
  }

  async purgeService(serviceId, fastlyToken) {
    return this.request({ method: "POST", path: `/service/${encodeURIComponent(serviceId)}/purge_all`, fastlyToken });
  }

  async purgeSurrogateKey(surrogateKey, fastlyToken) {
    return this.request({ method: "POST", path: `/purge/${encodeURIComponent(surrogateKey)}`, fastlyToken });
  }
}

export { FastlyServiceClient as TargetServiceClient };
