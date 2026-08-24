import assert from "node:assert/strict";
import test from "node:test";
import { FastlyServiceClient } from "../src/services/targetService.js";

test("Fastly client sends the user token as Fastly-Key", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ id: "svc-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const client = new FastlyServiceClient({ baseUrl: "https://api.fastly.com" });
    const result = await client.listServices("tenant-user-token");
    assert.equal(result.data.id, "svc-1");
    assert.equal(request.options.headers["Fastly-Key"], "tenant-user-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Fastly client rejects requests without a user token", async () => {
  const client = new FastlyServiceClient();
  await assert.rejects(() => client.request({ path: "/service" }), /user-scoped Fastly API token/);
});
