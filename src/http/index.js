import { env } from "../config/env.js";
import { createHttpMcpServer } from "./server.js";
import { createMcpServer } from "../mcp/server.js";
import { TargetServiceClient } from "../services/targetService.js";
import { ConfigStore } from "../services/configStore.js";
import { VaultService } from "../services/vault.js";

async function main() {
  if (env.transport.http.tls.enabled) {
    throw new Error(
      "MCP_HTTP_TLS_ENABLED=true is not supported in this process mode. Terminate TLS at a reverse proxy/load balancer."
    );
  }

  const targetServiceClient = new TargetServiceClient(env.targetService);
  const configStore = new ConfigStore(env.postgres, { appName: env.appName });
  const vaultService = new VaultService({ ...env.vault });

  const httpServer = createHttpMcpServer({
    host: env.transport.http.host,
    port: env.transport.http.port,
    mcpPath: env.transport.http.mcpPath,
    healthPath: env.transport.http.healthPath,
    authMode: env.transport.http.authMode,
    authTokens: env.transport.http.authTokens,
    trustedProxy: env.transport.http.trustedProxy,
    allowedOrigins: env.transport.http.allowedOrigins,
    allowedIps: env.transport.http.allowedIps,
    maxBodyBytes: env.transport.http.maxBodyBytes,
    rateLimitWindowMs: env.transport.http.rateLimitWindowMs,
    rateLimitMaxRequests: env.transport.http.rateLimitMaxRequests,
    createMcpServer: () =>
      createMcpServer({
        name: env.mcpServerName,
        version: env.mcpServerVersion,
        serviceClient: targetServiceClient,
        configStore,
        tokenStore: vaultService
      })
  });

  await httpServer.start();

  console.log(
    `HTTP MCP server listening on http://${httpServer.host}:${httpServer.port}${httpServer.mcpPath}`
  );

  const shutdown = async () => {
    await httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("HTTP MCP server failed to start", error);
  process.exit(1);
});
