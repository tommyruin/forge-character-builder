import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fontsRoot = fileURLToPath(
  new URL("../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
);
const fontNames = readdirSync(fontsRoot)
  .filter((name) => [".pfb", ".ttf"].includes(extname(name)))
  .sort();
const fontNameSet = new Set(fontNames);

export function pdfStandardFontsPlugin() {
  return {
    name: "pdfjs-standard-fonts",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const marker = "/pdfjs-standard-fonts/";
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const markerIndex = pathname.indexOf(marker);
        if (markerIndex < 0) {
          next();
          return;
        }
        const name = decodeURIComponent(pathname.slice(markerIndex + marker.length));
        if (!fontNameSet.has(name)) {
          next();
          return;
        }
        response.setHeader(
          "Content-Type",
          name.endsWith(".ttf") ? "font/ttf" : "application/x-font-type1",
        );
        response.end(readFileSync(join(fontsRoot, name)));
      });
    },
    generateBundle() {
      for (const name of fontNames) {
        this.emitFile({
          type: "asset",
          fileName: `pdfjs-standard-fonts/${name}`,
          source: readFileSync(join(fontsRoot, name)),
        });
      }
    },
  };
}
