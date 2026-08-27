/**
 * Dedicated sheet-render worker entry.
 *
 * The engine worker builds the sheet MODEL (cheap, ~25ms) and hands it off
 * here; this worker owns the expensive pdf-lib work (template fetch + page
 * fills + save) on its own thread, so choices and reads on the engine worker
 * never queue behind a multi-second PDF render. The client owns the worker
 * lifecycle and posts { id, model, templateBase, templateSet, colours, fonts, footerText }
 * requests; responses are { id, ok, bytes } with the bytes transferred (or
 * { id, ok, error }).
 */

import type { CharacterSheetModel } from "../sheet/model.js";
import {
  writeCharacterSheetPdf,
  writeCharacterSheetPdfWithTemplateBundle,
  type CharacterSheetTemplateBundle,
} from "../sheet/pdf.js";
import { fetchCharacterSheetTemplateBundle } from "../sheet/templates.js";
import { recolorSheetTemplate } from "../sheet/recolor.js";
import {
  DEFAULT_SHEET_TEMPLATE_SET,
  resolveSheetColours,
  resolveSheetFonts,
  sheetColoursKey,
  sheetFontsKey,
  type SheetColours,
  type SheetFonts,
  type SheetTemplateSet,
} from "../sheet/template-contract.js";

/** Minimal dedicated-worker scope: the render worker's messages are its own. */
export interface SheetRenderWorkerScope {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
}

export interface SheetRenderRequest {
  id: number;
  model: CharacterSheetModel;
  templateBase: string;
  /** Which template set to render against; the default set when omitted. */
  templateSet?: SheetTemplateSet;
  /** The colour names the templates are recoloured to; the defaults for any part omitted. */
  colours?: Partial<SheetColours>;
  /** The typeface names per role; the defaults for any role omitted. */
  fonts?: Partial<SheetFonts>;
  /** The line signed at the foot of every page; the writer's default when omitted. */
  footerText?: string;
}

export type SheetRenderResponse =
  | { id: number; ok: true; bytes: ArrayBuffer }
  | { id: number; ok: false; error: string };

/** Every template in the bundle, drawn in `colours`. */
async function recolorBundle(bundle: CharacterSheetTemplateBundle, colours: SheetColours): Promise<CharacterSheetTemplateBundle> {
  const recolor = (bytes: Uint8Array) => recolorSheetTemplate(bytes, colours);
  const [details, background, companion, equipment, spellcastingHeader, spellcastingSectionCenter, spellcastingSectionBottom, spellCard, genericCard, ...tops] =
    await Promise.all([
      recolor(bundle.details),
      recolor(bundle.background),
      recolor(bundle.companion),
      recolor(bundle.equipment),
      recolor(bundle.spellcastingHeader),
      recolor(bundle.spellcastingSectionCenter),
      recolor(bundle.spellcastingSectionBottom),
      recolor(bundle.spellCard),
      recolor(bundle.genericCard),
      ...bundle.spellcastingSectionTops.map(recolor),
    ]);
  return {
    labels: bundle.labels,
    faces: bundle.faces,
    details: details!,
    background: background!,
    companion: companion!,
    equipment: equipment!,
    spellcastingHeader: spellcastingHeader!,
    spellcastingSectionTops: tops,
    spellcastingSectionCenter: spellcastingSectionCenter!,
    spellcastingSectionBottom: spellcastingSectionBottom!,
    spellCard: spellCard!,
    genericCard: genericCard!,
  };
}

export function startSheetRenderWorker(scope: SheetRenderWorkerScope): void {
  // Cached per template set and colour scheme for this worker instance; an entry is
  // dropped when its fetch fails so the next request retries. A recreated
  // worker starts with a fresh cache.
  const templatePromises = new Map<string, Promise<CharacterSheetTemplateBundle | null>>();
  scope.addEventListener("message", (event) => {
    const request = event.data as SheetRenderRequest | undefined;
    if (request === undefined || typeof request.id !== "number" || request.model === undefined) return;
    void (async () => {
      try {
        const templateSet = request.templateSet ?? DEFAULT_SHEET_TEMPLATE_SET;
        const colours = resolveSheetColours(request.colours);
        const fonts = resolveSheetFonts(request.fonts);
        const cacheKey = `${templateSet}:${sheetColoursKey(colours)}:${sheetFontsKey(fonts)}`;
        let candidate = templatePromises.get(cacheKey);
        if (candidate === undefined) {
          candidate = fetchCharacterSheetTemplateBundle(request.templateBase, templateSet, fonts)
            .then((bundle) => (bundle === null ? null : recolorBundle(bundle, colours)));
          templatePromises.set(cacheKey, candidate);
        }
        let template: CharacterSheetTemplateBundle | null;
        try {
          template = await candidate;
        } catch (cause) {
          if (templatePromises.get(cacheKey) === candidate) templatePromises.delete(cacheKey);
          throw cause;
        }
        const bytes = template === null
          ? writeCharacterSheetPdf(request.model)
          : await writeCharacterSheetPdfWithTemplateBundle(request.model, template, { footerText: request.footerText, colours });
        const response: SheetRenderResponse = { id: request.id, ok: true, bytes };
        scope.postMessage(response, [bytes]);
      } catch (cause) {
        const response: SheetRenderResponse = {
          id: request.id,
          ok: false,
          error: cause instanceof Error
            ? cause.message
            : typeof cause === "object" && cause !== null && "message" in cause
              ? String((cause as { message: unknown }).message)
              : String(cause),
        };
        scope.postMessage(response);
      }
    })();
  });
}
