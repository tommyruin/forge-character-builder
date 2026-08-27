/*
 * Deterministic browser-worker bootstrap. The engine artifact is intentionally supplied by
 * deployment (VITE_FCB_ENGINE_WORKER_MODULE or the static URL below); this client package
 * does not copy private/generated engine output into its public tree.
 */
import { start as startBundledEngine } from "./engineWorkerEntry.js";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const artifactUrl = env?.VITE_FCB_ENGINE_WORKER_MODULE;

void (async () => {
  try {
    if (!artifactUrl) {
      startBundledEngine(self as never);
      return;
    }
    const artifact = await import(/* @vite-ignore */ artifactUrl);
    if (typeof artifact.start === "function") await artifact.start(self);
    else if (typeof artifact.default === "function") await artifact.default(self);
    else throw new Error("FCB engine worker artifact must export start(scope).");
  } catch (error) {
    self.postMessage({
      type: "fatal",
      error: error instanceof Error ? error.message : String(error),
    });
  }
})();
