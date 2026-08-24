import assert from "node:assert/strict";
import test from "node:test";

import { createMcpServer } from "../src/mcp/server.js";

function setEnv(updates) {
  const previous = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function createServiceClientMock() {
  const calls = {
    purge: 0,
    request: 0
  };

  const client = {
    getConnectionInfo() {
      return {
        baseUrl: "https://api.fastly.com",
        authMode: "per-user-fastly-key"
      };
    },
    listKnownEndpoints() {
      return [{ method: "GET", path: "/health_check" }];
    },
    async healthCheck() {
      return { status: 200, data: null };
    },
    async listServices() {
      return { status: 200, data: [] };
    },
    async listVersions() {
      return { status: 200, data: [] };
    },
    async purgeService(serviceId) {
      calls.purge += 1;
      return { status: 200, data: { serviceId } };
    },
    async request(payload) {
      calls.request += 1;
      return {
        status: 200,
        ...payload
      };
    }
  };

  return { client, calls };
}

async function invokeTool(server, name, args = {}) {
  const registeredTools = server._registeredTools;
  assert.ok(registeredTools[name], `Expected tool ${name} to be registered`);
  const result = await registeredTools[name].handler(args);
  const payload = JSON.parse(result.content[0].text);
  return { result, payload };
}

test("service_health_check returns ok", async () => {
  const restoreEnv = setEnv({ MCP_ADMIN_AUTH_KEY: "" });

  try {
    const { client } = createServiceClientMock();
    const server = createMcpServer({
      name: "skeleton-mcp",
      version: "0.1.0",
      serviceClient: client
    });

    const { payload } = await invokeTool(server, "service_health_check");

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 200);
    assert.equal(payload.data.status, 200);
  } finally {
    restoreEnv();
  }
});

test("Fastly purge tools require authorizationKey when admin key is configured", async () => {
  const restoreEnv = setEnv({ MCP_ADMIN_AUTH_KEY: "super-secret" });

  try {
    const { client, calls } = createServiceClientMock();
    const server = createMcpServer({
      name: "skeleton-mcp",
      version: "0.1.0",
      serviceClient: client
    });

    const unauthorized = await invokeTool(server, "fastly_purge_service", {
      serviceId: "service-1",
      fastlyToken: "user-token"
    });
    assert.equal(unauthorized.result.isError, true);
    assert.equal(unauthorized.payload.status, 401);

    const authorized = await invokeTool(server, "fastly_purge_service", {
      serviceId: "service-1",
      fastlyToken: "user-token",
      authorizationKey: "super-secret"
    });
    assert.equal(authorized.payload.ok, true);
    assert.equal(calls.purge, 1);

    const genericUnauthorized = await invokeTool(server, "service_api_request", {
      method: "POST",
      path: "/service/service-1/purge_all",
      fastlyToken: "user-token"
    });
    assert.equal(genericUnauthorized.result.isError, true);
    assert.equal(genericUnauthorized.payload.status, 401);

    const genericAuthorized = await invokeTool(server, "service_api_request", {
      method: "POST",
      path: "/service/service-1/purge_all",
      fastlyToken: "user-token",
      authorizationKey: "super-secret"
    });
    assert.equal(genericAuthorized.payload.ok, true);
    assert.equal(calls.request, 1);
  } finally {
    restoreEnv();
  }
});

test("service_query_suggestion returns tool schemas and recommended flow", async () => {
  const restoreEnv = setEnv({ MCP_ADMIN_AUTH_KEY: "" });

  try {
    const { client } = createServiceClientMock();
    const server = createMcpServer({
      name: "skeleton-mcp",
      version: "0.1.0",
      serviceClient: client
    });

    const { payload } = await invokeTool(server, "service_query_suggestion", {
      intent: "discover available endpoints and then read car details",
      method: "get",
      path: "api/car/42"
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 200);
    assert.equal(Array.isArray(payload.data.recommendedOrder), true);
    assert.equal(Array.isArray(payload.data.toolSchemas), true);
    assert.equal(payload.data.summary.operationIsMutating, false);

    const recommendedTools = payload.data.recommendedOrder.map((item) => item.tool);
    assert.ok(recommendedTools.includes("service_connection_info"));
    assert.ok(recommendedTools.includes("service_health_check"));
    assert.ok(recommendedTools.includes("service_list_endpoints"));
    assert.ok(recommendedTools.includes("service_api_request"));

    const schemaTools = payload.data.toolSchemas.map((item) => item.name);
    assert.ok(schemaTools.includes("service_connection_info"));
    assert.ok(schemaTools.includes("service_scope_info"));
    assert.ok(schemaTools.includes("service_list_endpoints"));
    assert.ok(schemaTools.includes("service_health_check"));
    assert.ok(schemaTools.includes("fastly_purge_service"));
    assert.ok(schemaTools.includes("fastly_list_services"));
    assert.ok(schemaTools.includes("fastly_list_versions"));
    assert.ok(schemaTools.includes("service_api_request"));
  } finally {
    restoreEnv();
  }
});

test("service_query_suggestion flags mutating operations when admin auth is enabled", async () => {
  const restoreEnv = setEnv({ MCP_ADMIN_AUTH_KEY: "super-secret" });

  try {
    const { client } = createServiceClientMock();
    const server = createMcpServer({
      name: "skeleton-mcp",
      version: "0.1.0",
      serviceClient: client
    });

    const { payload } = await invokeTool(server, "service_query_suggestion", {
      operationType: "mutate",
      method: "patch",
      path: "/api/car/7"
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.data.summary.operationIsMutating, true);
    assert.equal(payload.data.summary.adminAuthorizationKeyRequired, true);
  } finally {
    restoreEnv();
  }
});
