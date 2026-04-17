// Preload for page-level tests: registers Happy DOM globals (window, document,
// HTMLElement, etc.) onto globalThis so @testing-library/react can mount.
// Loaded via a preload directive in the happy-dom test files themselves.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!(globalThis as unknown as { document?: unknown }).document) {
  GlobalRegistrator.register();
}
