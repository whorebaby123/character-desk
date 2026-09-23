using Workerd = import "/workerd/workerd.capnp";
# No listening sockets or internet egress. Exercise the real Worker engine
# against an in-process provider fixture, not Node's more permissive fetch.
const config :Workerd.Config = (
 services = [
  (name = "app", worker = (
   compatibilityDate = "2026-05-15",
   compatibilityFlags = ["nodejs_compat"],
   globalOutbound = "provider",
   modules = [
    (name = "index.js", esModule = embed "../dist/server/index.js"),
    (name = "__vite_rsc_assets_manifest.js", esModule = embed "../dist/server/__vite_rsc_assets_manifest.js")
   ]
  )),
  (name = "provider", worker = (
   compatibilityDate = "2026-05-15",
   modules = [(name = "provider.js", esModule = embed "workerd-provider.mjs")]
  )),
  (name = "test", worker = (
   compatibilityDate = "2026-05-15",
   bindings = [(name = "APP", service = "app")],
   modules = [(name = "test.js", esModule = embed "workerd-cases.mjs")]
  ))
 ],
 sockets = []
);
