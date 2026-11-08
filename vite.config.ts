import path from "node:path";
import { fileURLToPath } from "node:url";
import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Optional D1/R2 bindings for the original Sites project. Empty unless hosting.json sets them.

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  // Vercel sets VERCEL=1. That build uses Nitro (Node), where public IP
  // endpoints are fetched directly. Local dev and Workers keep the
  // Cloudflare plugin, which reaches IPs through cloudflare:sockets.
  const onVercel = process.env.VERCEL === "1" || Boolean(process.env.NITRO_PRESET);
  const nodeConnect = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "lib/load-connect-node.ts");
  const platform = onVercel
    ? (await import("nitro/vite")).nitro({
        vercel: { functions: { runtime: "nodejs22.x" } },
      })
    : (await import("@cloudflare/vite-plugin")).cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config() {
          return {
            ...(d1
              ? {
                  d1_databases: [
                    {
                      binding: d1,
                      database_name: "site-creator-d1",
                      database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
                    },
                  ],
                }
              : {}),
            ...(r2
              ? {
                  r2_buckets: [{ binding: r2, bucket_name: "site-creator-r2" }],
                }
              : {}),
          };
        },
      });

  return {
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      tailwindcss(),
      vinext(),
      sites(),
      platform,
      onVercel
        ? {
            name: "use-node-fetch-for-ip",
            enforce: "pre" as const,
            resolveId(id: string) {
              if (id === "./load-connect.ts" || id.endsWith("/load-connect.ts")) return nodeConnect;
            },
          }
        : undefined,
    ],
  };
});
