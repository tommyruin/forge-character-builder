import { startBrowserCharacterEngineWorker } from "@forge-cb/engine/browser";
import type { WorkerScope } from "@forge-cb/api";

// This is the browser-safe FCB entry. It constructs the empty content library and
// starts the typed engine dispatcher; no generated/private engine artifact is loaded.
export function start(scope: WorkerScope): void {
  startBrowserCharacterEngineWorker(scope);
}
