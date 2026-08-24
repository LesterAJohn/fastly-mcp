import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getVaultTenantPrincipalTokenIndexPath,
  normalizeAppName,
  normalizePrincipalIdForPath,
  normalizeTenantIdForPath,
  resolveTenantPrincipalScope
} from "../config/vaultAuthTokenIndex.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const TOOL_CATALOG = [
  {
    name: "service_connection_info",
    category: "read-only",
    risk: "low",
    description: "Return MCP server and target service connection details.",
    requiresAuthorizationKey: false,
    parameters: []
  },
  {
    name: "service_scope_info",
    category: "read-only",
    risk: "low",
    description: "Return app/tenant/principal scoping metadata used by Postgres config and Vault token index paths.",
    requiresAuthorizationKey: false,
    parameters: [
      {
        name: "tenantId",
        type: "string",
        required: true,
        notes: "Tenant identifier to scope config and Vault paths"
      },
      {
        name: "userId",
        type: "string",
        required: false,
        notes: "Provide either userId or accountId"
      },
      {
        name: "accountId",
        type: "string",
        required: false,
        notes: "Provide either accountId or userId"
      }
    ]
  },
  {
    name: "service_list_endpoints",
    category: "read-only",
    risk: "low",
    description: "List documented/implemented target service HTTP endpoints exposed by this MCP server.",
    requiresAuthorizationKey: false,
    parameters: []
  },
  {
    name: "service_health_check",
    category: "read-only",
    risk: "low",
    description: "Read-only Fastly credential check using GET /tokens/self.",
    requiresAuthorizationKey: false,
    parameters: [{ name: "fastlyToken", type: "string", required: true }]
  },
  {
    name: "fastly_purge_service",
    category: "mutating",
    risk: "high",
    description: "High-risk purge-all mutation for a Fastly service.",
    requiresAuthorizationKey: true,
    parameters: [
      {
        name: "serviceId",
        type: "string",
        required: true
      },
      {
        name: "fastlyToken",
        type: "string",
        required: true
      },
      {
        name: "authorizationKey",
        type: "string",
        required: false,
        notes: "Required when MCP_ADMIN_AUTH_KEY is configured"
      }
    ]
  },
  {
    name: "fastly_list_services",
    category: "read-only",
    risk: "low",
    description: "List Fastly services for a user token.",
    requiresAuthorizationKey: false,
    parameters: [
      {
        name: "fastlyToken",
        type: "string",
        required: true
      }
    ]
  },
  {
    name: "fastly_list_versions",
    category: "read-only",
    risk: "low",
    description: "List versions for a Fastly service.",
    requiresAuthorizationKey: false,
    parameters: [
      {
        name: "serviceId",
        type: "string",
        required: true
      },
      {
        name: "fastlyToken",
        type: "string",
        required: true
      }
    ]
  },
  {
    name: "service_api_request",
    category: "read-only-or-mutating",
    risk: "variable",
    description: "Generic target service HTTP API call with host/auth safeguards.",
    requiresAuthorizationKey: true,
    parameters: [
      {
        name: "method",
        type: "string",
        required: true
      },
      {
        name: "path",
        type: "string",
        required: true
      },
      {
        name: "query",
        type: "object<string, string|number|boolean>",
        required: false
      },
      {
        name: "body",
        type: "json",
        required: false
      },
      {
        name: "headers",
        type: "object<string, string>",
        required: false
      },
      {
        name: "authorizationKey",
        type: "string",
        required: false,
        notes: "Required for mutating methods when MCP_ADMIN_AUTH_KEY is configured"
      }
    ]
  }
];

function isMutatingOperation(method) {
  return MUTATING_METHODS.has(normalizeMethod(method));
}

function inferIntentSignals({ intent = "", method = "", path = "", operationType = "" }) {
  const normalizedIntent = String(intent).toLowerCase();
  const normalizedPath = String(path).toLowerCase();
  const normalizedOperation = String(operationType).toLowerCase();

  return {
    wantsSuspend:
      normalizedOperation === "suspend_logging" ||
      normalizedIntent.includes("suspend") ||
      normalizedIntent.includes("disable logging") ||
      normalizedPath.includes("logging/suspend"),
    wantsResume:
      normalizedOperation === "resume_logging" ||
      normalizedIntent.includes("resume") ||
      normalizedIntent.includes("enable logging") ||
      normalizedPath.includes("logging/resume"),
    wantsGpx:
      normalizedOperation === "get_drive_gpx" ||
      normalizedIntent.includes("gpx") ||
      normalizedIntent.includes("drive") ||
      normalizedPath.includes("/drive/"),
    wantsScopedInfo:
      normalizedOperation === "scoped" ||
      normalizedIntent.includes("scope") ||
      normalizedIntent.includes("user") ||
      normalizedIntent.includes("vault") ||
      normalizedIntent.includes("postgres"),
    wantsDiscovery:
      normalizedOperation === "discover" ||
      normalizedIntent.includes("discover") ||
      normalizedIntent.includes("schema") ||
      normalizedIntent.includes("endpoint")
  };
}

function suggestToolSequence({ intent, method, path, operationType }) {
  const sequence = [
    {
      tool: "service_connection_info",
      reason: "Establish runtime connection/auth/scope context before any call."
    },
    {
      tool: "service_health_check",
      reason: "Verify target service reachability and credentials."
    }
  ];

  const signals = inferIntentSignals({ intent, method, path, operationType });

  if (signals.wantsDiscovery || !method) {
    sequence.push({
      tool: "service_list_endpoints",
      reason: "Discover implemented routes and confirm path patterns."
    });
  }

  if (signals.wantsScopedInfo) {
    sequence.push({
      tool: "service_scope_info",
      reason: "Resolve app/user scope details before scoped workflows."
    });
  }

  if (signals.wantsSuspend) {
    sequence.push({
      tool: "service_suspend_logging",
      reason: "Use the specialized mutating tool for clear intent and safer contract."
    });
  } else if (signals.wantsResume) {
    sequence.push({
      tool: "service_resume_logging",
      reason: "Use the specialized mutating tool for clear intent and safer contract."
    });
  } else if (signals.wantsGpx) {
    sequence.push({
      tool: "service_get_drive_gpx",
      reason: "Use the dedicated GPX export tool for drive data retrieval."
    });
  } else if (method || path) {
    sequence.push({
      tool: "service_api_request",
      reason: "Use generic request mode for endpoints without a specialized tool."
    });
  }

  return sequence;
}

function normalizeMethod(method) {
  return String(method ?? "GET").trim().toUpperCase();
}

function normalizePath(path) {
  const raw = String(path ?? "").trim();
  if (!raw) {
    return "/";
  }

  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function createMcpServer({ name, version, serviceClient, configStore, tokenResolver, tokenStore }) {
  const server = new McpServer({
    name,
    version
  });

  const adminAuthKey = process.env.MCP_ADMIN_AUTH_KEY;
  const appName = normalizeAppName(process.env.APP_NAME ?? "skeleton");
  const defaultTenantId = String(process.env.MCP_CONFIG_DEFAULT_TENANT_ID ?? "default").trim() || "default";
  const defaultUserId = String(process.env.MCP_CONFIG_DEFAULT_USER_ID ?? "default").trim() || "default";
  const defaultAccountId = String(process.env.MCP_CONFIG_DEFAULT_ACCOUNT_ID ?? defaultUserId).trim() || defaultUserId;
  const defaultPrincipalType = String(process.env.MCP_CONFIG_DEFAULT_PRINCIPAL_TYPE ?? "user")
    .trim()
    .toLowerCase() === "account"
    ? "account"
    : "user";

  function getScopeModel(scope = {}) {
    const resolvedScope = resolveTenantPrincipalScope(scope, {
      defaultTenantId,
      defaultPrincipalType,
      defaultPrincipalId: defaultPrincipalType === "account" ? defaultAccountId : defaultUserId
    });

    return {
      appName,
      tenantId: resolvedScope.tenantId,
      tenantIdPathSegment: normalizeTenantIdForPath(resolvedScope.tenantId),
      principalType: resolvedScope.principalType,
      principalId: resolvedScope.principalId,
      principalIdPathSegment: normalizePrincipalIdForPath(resolvedScope.principalId),
      userId: resolvedScope.userId,
      accountId: resolvedScope.accountId,
      postgres: {
        tableName: `${appName}_config`,
        primaryKey: ["tenant_id", "principal_type", "principal_id", "key"],
        scope: "tenant_and_principal"
      },
      vault: {
        tokenIndexPath: getVaultTenantPrincipalTokenIndexPath(appName, resolvedScope),
        scope: "tenant_and_principal"
      }
    };
  }

  function asText(value) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(value, null, 2)
        }
      ]
    };
  }

  function classifyToolError(error) {
    const status = Number(error?.status ?? error?.statusCode ?? 500);
    const message = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      status: Number.isFinite(status) ? status : 500,
      error: message
    };
  }

  function withErrorHandling(handler) {
    return async (args) => {
      try {
        return asText(await handler(args));
      } catch (error) {
        return {
          ...asText(classifyToolError(error)),
          isError: true
        };
      }
    };
  }

  function assertAuthorized(authorizationKey) {
    if (!adminAuthKey) {
      return;
    }

    if (!authorizationKey || authorizationKey !== adminAuthKey) {
      const unauthorized = new Error("Unauthorized: invalid authorizationKey for mutating API operation");
      unauthorized.status = 401;
      throw unauthorized;
    }
  }

  server.tool(
    "fastly_get_config",
    "Read-only: retrieve one tenant/user or tenant/account configuration key from Postgres. Never stores secrets.",
    { tenantId: z.string().min(1), userId: z.string().min(1).optional(), accountId: z.string().min(1).optional(), key: z.string().min(1) },
    withErrorHandling(async ({ tenantId, userId, accountId, key }) => {
      if (!configStore) throw Object.assign(new Error("Postgres config store is not configured"), { status: 503 });
      if (Boolean(userId) === Boolean(accountId)) throw Object.assign(new Error("Provide exactly one of userId or accountId"), { status: 400 });
      return { ok: true, status: 200, data: await configStore.getConfig(key, { tenantId, userId, accountId }) };
    })
  );

  server.tool(
    "fastly_set_config",
    "Mutating: persist non-secret tenant/user or tenant/account configuration in Postgres. Reject tokens and secrets; requires the admin key when configured.",
    { tenantId: z.string().min(1), userId: z.string().min(1).optional(), accountId: z.string().min(1).optional(), key: z.string().min(1), value: z.unknown(), authorizationKey: z.string().min(1).optional() },
    withErrorHandling(async ({ tenantId, userId, accountId, key, value, authorizationKey }) => {
      assertAuthorized(authorizationKey);
      if (!configStore) throw Object.assign(new Error("Postgres config store is not configured"), { status: 503 });
      if (Boolean(userId) === Boolean(accountId)) throw Object.assign(new Error("Provide exactly one of userId or accountId"), { status: 400 });
      if (/token|secret|password|api[_-]?key|private[_-]?key/i.test(key)) throw Object.assign(new Error("Secret material must be persisted in Vault, not Postgres"), { status: 400 });
      return { ok: true, status: 200, data: await configStore.setConfig(key, value, { tenantId, userId, accountId }) };
    })
  );

  server.tool(
    "service_query_suggestion",
    "Discover MCP tool schemas and get query/tool recommendations for a workflow intent.",
    {
      intent: z.string().min(1).optional(),
      operationType: z
        .enum(["discover", "read", "mutate", "suspend_logging", "resume_logging", "get_drive_gpx", "scoped"])
        .optional(),
      method: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
      includeExamples: z.boolean().optional(),
      includeToolSchemas: z.boolean().optional()
    },
    withErrorHandling(async ({ intent, operationType, method, path, includeExamples, includeToolSchemas }) => {
      const normalizedMethod = method ? normalizeMethod(method) : "";
      const normalizedPath = path ? normalizePath(path) : "";
      const operationIsMutating =
        isMutatingOperation(normalizedMethod) || String(operationType ?? "").toLowerCase() === "mutate";

      const recommendedOrder = suggestToolSequence({
        intent,
        method: normalizedMethod,
        path: normalizedPath,
        operationType
      });

      const response = {
        ok: true,
        status: 200,
        data: {
          summary: {
            intent: intent ?? null,
            operationType: operationType ?? null,
            method: normalizedMethod || null,
            path: normalizedPath || null,
            operationIsMutating,
            adminAuthorizationKeyRequired: Boolean(adminAuthKey) && operationIsMutating
          },
          recommendedOrder,
          safetyChecks: [
            "Start with service_connection_info and service_health_check before operational calls.",
            "Prefer specialized tools over service_api_request when available.",
            "For mutating calls, verify path/method/body and provide authorizationKey if MCP_ADMIN_AUTH_KEY is configured.",
            "For tenant-aware workflows, always supply tenantId and exactly one of userId or accountId to service_scope_info.",
            "Use service_list_endpoints to reduce path/schema mistakes."
          ]
        }
      };

      if (includeExamples !== false) {
        response.data.examples = {
          read: {
            tool: "service_api_request",
            arguments: {
              method: "GET",
              path: "/api/car/42"
            }
          },
          mutate: {
            tool: "service_api_request",
            arguments: {
              method: "PATCH",
              path: "/api/car/42",
              body: {
                nickname: "track-ready"
              },
              authorizationKey: "<admin-key-if-required>"
            }
          }
        };
      }

      if (includeToolSchemas !== false) {
        response.data.toolSchemas = TOOL_CATALOG;
      }

      return response;
    })
  );

  server.tool(
    "service_connection_info",
    "Return MCP server and target service connection details.",
    {},
    withErrorHandling(async () => ({
      ok: true,
      status: 200,
      data: {
        server: {
          name,
          version,
          adminAuthConfigured: Boolean(adminAuthKey),
          scopeModel: getScopeModel()
        },
        service: serviceClient.getConnectionInfo()
      }
    }))
  );

  server.tool(
    "service_scope_info",
    "Return app/tenant/principal scoping metadata used by Postgres config and Vault token index paths.",
    {
      tenantId: z.string().min(1),
      userId: z.string().min(1).optional(),
      accountId: z.string().min(1).optional()
    },
    withErrorHandling(async ({ tenantId, userId, accountId }) => {
      if (Boolean(userId) === Boolean(accountId)) {
        throw Object.assign(new Error("Provide exactly one of userId or accountId"), { status: 400 });
      }

      return {
        ok: true,
        status: 200,
        data: getScopeModel({ tenantId, userId, accountId })
      };
    })
  );

  server.tool(
    "service_list_endpoints",
    "List documented/implemented target service HTTP endpoints exposed by this MCP server.",
    {},
    withErrorHandling(async () => ({
      ok: true,
      status: 200,
      data: {
        endpoints: serviceClient.listKnownEndpoints()
      }
    }))
  );

  server.tool(
    "service_health_check",
    "Read-only: validate a user-scoped Fastly token with GET /tokens/self. Requires a Fastly token.",
    { fastlyToken: z.string().min(1) },
    withErrorHandling(async ({ fastlyToken }) => ({
      ok: true,
      status: 200,
      data: await serviceClient.healthCheck(fastlyToken)
    }))
  );

  server.tool(
    "fastly_list_services",
    "Read-only: list services visible to the supplied Fastly user token. Follow with fastly_list_versions or service_api_request.",
    {
      fastlyToken: z.string().min(1)
    },
    withErrorHandling(async ({ fastlyToken }) => ({
        ok: true,
        status: 200,
        data: await serviceClient.listServices(fastlyToken)
    }))
  );

  server.tool(
    "fastly_list_versions",
    "Read-only: list versions for a Fastly service. Requires serviceId and a user token.",
    {
      serviceId: z.string().min(1),
      fastlyToken: z.string().min(1)
    },
    withErrorHandling(async ({ serviceId, fastlyToken }) => ({
        ok: true,
        status: 200,
        data: await serviceClient.listVersions(serviceId, fastlyToken)
    }))
  );

  server.tool(
    "fastly_purge_service",
    "High-risk mutation: purge all cached content for a Fastly service. Confirm serviceId and require MCP_ADMIN_AUTH_KEY when configured.",
    {
      serviceId: z.string().min(1),
      fastlyToken: z.string().min(1),
      authorizationKey: z.string().min(1).optional()
    },
    withErrorHandling(async ({ serviceId, fastlyToken, authorizationKey }) => {
      assertAuthorized(authorizationKey);
      return {
      ok: true,
      status: 200,
      data: await serviceClient.purgeService(serviceId, fastlyToken)
      };
    })
  );

  server.tool(
    "fastly_update_user_token",
    "High-risk mutation: persist or rotate one tenant/user or tenant/account Fastly token in Vault. Never use for configuration; provide scope and admin authorization.",
    {
      tenantId: z.string().min(1),
      userId: z.string().min(1).optional(),
      accountId: z.string().min(1).optional(),
      fastlyToken: z.string().min(1),
      authorizationKey: z.string().min(1).optional()
    },
    withErrorHandling(async ({ tenantId, userId, accountId, fastlyToken, authorizationKey }) => {
      assertAuthorized(authorizationKey);
      if (!tokenStore) throw Object.assign(new Error("Vault token store is not configured"), { status: 503 });
      if (Boolean(userId) === Boolean(accountId)) {
        throw Object.assign(new Error("Provide exactly one of userId or accountId"), { status: 400 });
      }
      const scope = getScopeModel({ tenantId, userId, accountId });
      const path = `${scope.vault.tokenIndexPath}/fastly`;
      const result = await tokenStore.setSecret(path, { fastlyToken, tenantId, principalType: scope.principalType, principalId: scope.principalId });
      return { ok: true, status: 200, data: { ...result, scope: { tenantId, principalType: scope.principalType, principalId: scope.principalId }, tokenPersisted: true } };
    })
  );

  server.tool(
    "service_api_request",
    "Generic target service HTTP API call. Supports all available endpoints while enforcing host/auth safeguards.",
    {
      method: z.string().min(1),
      path: z.string().min(1),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      body: z.unknown().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      fastlyToken: z.string().min(1),
      authorizationKey: z.string().min(1).optional()
    },
    withErrorHandling(async ({ method, path, query, body, headers, fastlyToken, authorizationKey }) => {
      const normalizedMethod = normalizeMethod(method);
      const normalizedPath = normalizePath(path);

      if (MUTATING_METHODS.has(normalizedMethod)) {
        assertAuthorized(authorizationKey);
      }

      return {
        ok: true,
        status: 200,
        data: await serviceClient.request({
          method: normalizedMethod,
          path: normalizedPath,
          query,
          body,
          headers,
          fastlyToken
        })
      };
    })
  );

  return server;
}
