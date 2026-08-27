import { describe, expect, it, vi } from "vitest";
import { pdfStandardFontsPlugin } from "./pdfStandardFonts.mjs";

describe("PDF.js standard-font assets", () => {
  it("emits the complete local font set with stable filenames", () => {
    const plugin = pdfStandardFontsPlugin();
    const emitFile = vi.fn();

    plugin.generateBundle.call({ emitFile });

    const emitted = emitFile.mock.calls.map(([asset]) => asset.fileName);
    expect(emitted).toContain("pdfjs-standard-fonts/FoxitDingbats.pfb");
    expect(emitted).toContain("pdfjs-standard-fonts/LiberationSans-Regular.ttf");
    expect(emitted).toHaveLength(14);
  });
});
