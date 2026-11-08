// Workers builds keep this static import so the runtime can open TCP
// connections to public IP addresses. The Vercel build aliases this module
// to load-connect-node.ts, which has no Workers-only import.
export async function loadConnect() {
  try {
    const mod = await import("cloudflare:sockets");
    return typeof mod.connect === "function" ? mod.connect : null;
  } catch {
    return null;
  }
}
