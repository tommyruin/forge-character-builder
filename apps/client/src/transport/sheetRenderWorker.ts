/*
 * Dedicated sheet-render worker bootstrap. The engine worker builds the sheet
 * model; this worker owns the pdf-lib work on its own thread so choices and
 * reads never queue behind a PDF render.
 */
import { startSheetRenderWorker } from "@forge-cb/engine/browser";

startSheetRenderWorker(self as never);
