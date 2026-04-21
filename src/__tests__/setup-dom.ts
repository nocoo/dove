// Conditional preload: only register Happy DOM when ENABLE_DOM_TESTS is set.
// Wired via the root bunfig.toml as a global preload — but Happy DOM patches
// globalThis.fetch with a Same-Origin Policy enforcer, which breaks the L2
// E2E runner (it talks to a real http://localhost:17034 dev server). The env
// gate keeps the unit-test path clean unless `bun run test` opts in.
if (process.env["ENABLE_DOM_TESTS"]) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GlobalRegistrator } = require("@happy-dom/global-registrator");
  if (!(globalThis as unknown as { document?: unknown }).document) {
    GlobalRegistrator.register();
  }
}
export {};
