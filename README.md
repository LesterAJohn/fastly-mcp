# fastly-mcp

A Node.js Model Context Protocol server for the Fastly REST API. It supports stdio and Streamable HTTP transports, tenant-scoped user or account identities, persistent Postgres configuration, and persistent Vault secrets.

## Guarantees

- Every Fastly request uses the caller's user-scoped `Fastly-Key`; no shared Fastly token is configured in the process.
- Token material is written only to Vault at `fastly/tenants/<tenant>/{users|accounts}/<principal>/http/auth/token-index/fastly`.
- Non-secret configuration uses the Postgres table `fastly_config`, keyed by tenant, principal type, principal ID, and key.
- Mutations require `MCP_ADMIN_AUTH_KEY` through the `authorizationKey` tool parameter when that environment variable is set.
- `service_api_request` supports every documented Fastly method and path, including APIs added after this server release.

## Tools

`service_query_suggestion` is read-only schema discovery. Use it when intent or the correct Fastly route is unclear; it returns recommended prerequisites, safety checks, tool schemas, and examples.

`service_connection_info` and `service_scope_info` are read-only runtime and tenant/account discovery tools. Use them before an operational workflow.

`service_health_check` calls `GET /tokens/self` with a user token. `fastly_list_services` calls `GET /service`. `fastly_list_versions` calls `GET /service/:service_id/version`.

`service_api_request` is the full-coverage escape hatch. It accepts `method`, `path`, optional `query`, `body`, `headers`, and required `fastlyToken`. GET/HEAD are read-only; POST/PUT/PATCH/DELETE are mutations and require `authorizationKey` when configured.

`fastly_purge_service` is high-risk and calls `POST /service/:service_id/purge_all`. Confirm the service ID and use the admin key. `fastly_update_user_token` is high-risk and persists a replacement token in Vault; provide exactly one of `userId` or `accountId`, plus `tenantId`, `fastlyToken`, and the admin key.

All responses contain JSON text shaped as `{ "ok": true, "status": 200, "data": {} }`; failures set MCP `isError` and return `{ "ok": false, "status": 4xx, "error": "..." }`. Secret-looking fields are redacted by default.

## Configuration

Copy `.env.example` to `.env`. Set `POSTGRES_*`, `VAULT_ADDR`, `VAULT_TOKEN` or Vault Agent settings, and `MCP_ADMIN_AUTH_KEY`. `TARGET_SERVICE_BASE_URL` defaults to `https://api.fastly.com`. Use `MCP_TRANSPORT_MODE=stdio`, `http`, or `both`.

Run local dependencies with `docker compose up -d postgres vault`, then initialize Vault according to `vault-production/README.md`. Start the server with `npm start`, or use `npm run start:http` for HTTP. The HTTP endpoint defaults to `http://127.0.0.1:3000/mcp` and requires a bearer token.

## External Services Mode

Use `docker-compose.external.yml` when Fastly MCP connects to external Vault and Postgres services. Set `POSTGRES_HOST`, `VAULT_ADDR`, and the corresponding credentials before starting the app-only Compose service.

## Inventory and tests

`npm run inventory:generate` fetches Fastly's API reference index, or a JSON OpenAPI document supplied by `FASTLY_OPENAPI_URL`, and writes `artifacts/fastly-openapi-endpoints.json`. The artifact is committed and CI fails when generation changes it.

`npm test` runs the Fastly client, MCP authorization, persistence-supporting infrastructure, HTTP, and Vault tests. GitHub Actions runs inventory generation before the test job.

## MCP client registration

```json
{
  "mcpServers": {
    "fastly-mcp": {
      "command": "npm",
      "args": ["run", "start:stdio"],
      "cwd": "/Users/{user}/Documents/GitHub/fastly-mcp"
    }
  }
}
```

## Development notes

The Fastly API uses TLS 1.2 or later and applies separate read, write, and purge limits. Avoid concurrent writes to the same service. Never log or commit `fastlyToken` values. This project is released under the MIT License; see [LICENSE](LICENSE).
