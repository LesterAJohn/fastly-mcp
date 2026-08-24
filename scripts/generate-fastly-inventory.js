import { mkdir, writeFile } from "node:fs/promises";

const specUrl = process.env.FASTLY_OPENAPI_URL || "https://www.fastly.com/documentation/reference/api/index";
const outputPath = process.env.FASTLY_INVENTORY_OUTPUT || "artifacts/fastly-openapi-endpoints.json";
const response = await fetch(specUrl);
if (!response.ok) throw new Error(`Unable to fetch Fastly API source: ${response.status}`);
const text = await response.text();
let endpoints = [];
try {
  const spec = JSON.parse(text);
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      if (pathItem[method]) endpoints.push({ method: method.toUpperCase(), path, operationId: pathItem[method].operationId || null, summary: pathItem[method].summary || null });
    }
  }
} catch {
  const links = [...text.matchAll(/href=["']([^"']*\/documentation\/reference\/api\/[^"']*)["']/gi)]
    .map((match) => match[1].split("#")[0])
    .filter((link) => !link.endsWith("/index"));
  endpoints = [...new Set(links)].sort().map((path) => ({ method: "DOCUMENTED", path, operationId: null, summary: "Fastly API reference endpoint" }));
}
if (!endpoints.length) throw new Error("Fastly API source contained no endpoints");
await mkdir(outputPath.substring(0, outputPath.lastIndexOf("/")), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ source: specUrl, endpointCount: endpoints.length, endpoints }, null, 2)}\n`);
console.log(`Wrote ${endpoints.length} Fastly endpoints to ${outputPath}`);
