import { describe, expect, it } from "vitest";
import { createEmptyLibrary } from "./library.js";
import { contentStatus, ingestContentFiles, removeContentFiles } from "./ingestion.js";
import { encodeBase64 } from "../platform.js";

const xml = (name: string, id: string): string =>
  `<elements><element id="${id}" name="${name}" type="Item" source="Homebrew"><set name="category">Tools</set></element></elements>`;

describe("browser content ingestion", () => {
  it("hydrates the same library object and bumps revision for upload/replace/remove", async () => {
    const library = createEmptyLibrary();
    const identity = library;
    const first = encodeBase64(new TextEncoder().encode(xml("One", "ID_ONE")));
    await ingestContentFiles(library, [{ path: "homebrew/rules.xml", base64: first }]);
    expect(library).toBe(identity);
    expect(library.byId.get("ID_ONE")?.identity.name).toBe("One");
    expect(contentStatus(library)).toMatchObject({ elementCount: 1, fileCount: 1, revision: 1 });

    const second = encodeBase64(new TextEncoder().encode(xml("Two", "ID_TWO")));
    await ingestContentFiles(library, [{ path: "homebrew/rules.xml", base64: second }]);
    expect(library.byId.has("ID_ONE")).toBe(false);
    expect(library.byId.get("ID_TWO")?.identity.name).toBe("Two");
    expect(contentStatus(library).revision).toBe(2);

    removeContentFiles(library, ["homebrew/rules.xml"]);
    expect(contentStatus(library)).toMatchObject({ elementCount: 0, fileCount: 0, revision: 3 });
  });

  it("lets uploaded imports/ content override bundled elements with the same id", async () => {
    const library = createEmptyLibrary();
    const bundled = encodeBase64(new TextEncoder().encode(xml("Bundled", "ID_SHARED")));
    const uploaded = encodeBase64(new TextEncoder().encode(xml("Uploaded", "ID_SHARED")));
    // "imports/…" sorts lexicographically before "testdata/…"; the ingest tier
    // must still put user uploads after the bundled corpus so the upload wins.
    await ingestContentFiles(library, [
      { path: "imports/my-pack/rules.xml", base64: uploaded },
      { path: "testdata/core/rules.xml", base64: bundled },
    ]);
    expect(library.byId.get("ID_SHARED")?.identity.name).toBe("Uploaded");
  });

  it("skips uploaded .index updater manifests instead of counting them as content", async () => {
    const library = createEmptyLibrary();
    const index = encodeBase64(new TextEncoder().encode(
      '<index><files><file name="core.xml" url="https://example.invalid/core.xml"/></files></index>',
    ));
    const element = encodeBase64(new TextEncoder().encode(xml("Real", "ID_REAL")));
    await ingestContentFiles(library, [
      { path: "imports/pack/core.index", base64: index },
      { path: "imports/pack/core.xml", base64: element },
    ]);
    expect(contentStatus(library)).toMatchObject({ elementCount: 1, fileCount: 1 });
    expect(library.byId.get("ID_REAL")?.identity.name).toBe("Real");
  });

  it("reports upload diagnostics scoped to the ingested files", async () => {
    const library = createEmptyLibrary();
    await ingestContentFiles(library, [
      { path: "testdata/base.xml", base64: encodeBase64(new TextEncoder().encode(xml("Base", "ID_DUP"))) },
    ]);
    const upload = await ingestContentFiles(library, [
      { path: "imports/pack/override.xml", base64: encodeBase64(new TextEncoder().encode(xml("Override", "ID_DUP"))) },
      { path: "imports/pack/empty.xml", base64: encodeBase64(new TextEncoder().encode("<elements></elements>")) },
      {
        path: "imports/pack/append.xml",
        base64: encodeBase64(new TextEncoder().encode(
          '<elements><append id="ID_MISSING_TARGET"><rules><stat name="ac" value="1"/></rules></append></elements>',
        )),
      },
    ]);
    const kinds = upload.diagnostics.map((diagnostic) => `${diagnostic.kind}:${diagnostic.file}`);
    expect(kinds).toContain("duplicate-id:imports/pack/override.xml");
    expect(kinds).toContain("empty-file:imports/pack/empty.xml");
    expect(kinds).toContain("append-target:imports/pack/append.xml");
    // Findings about files from earlier ingests do not repeat.
    expect(upload.diagnostics.every((diagnostic) => diagnostic.file.startsWith("imports/"))).toBe(true);
    // The upload still wins the collision.
    expect(library.byId.get("ID_DUP")?.identity.name).toBe("Override");
  });

  it("reads a stored ZIP upload and exposes its XML element", async () => {
    const payload = new TextEncoder().encode(xml("Zipped", "ID_ZIP"));
    const name = new TextEncoder().encode("nested/content.xml");
    const body = new Uint8Array(30 + name.length + payload.length);
    const view = new DataView(body.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, 0, true);
    view.setUint32(18, payload.length, true);
    view.setUint32(22, payload.length, true);
    view.setUint16(26, name.length, true);
    body.set(name, 30);
    body.set(payload, 30 + name.length);
    const library = createEmptyLibrary();
    await ingestContentFiles(library, [{ path: "bundle.zip", base64: encodeBase64(body) }]);
    expect(library.byId.get("ID_ZIP")?.identity.name).toBe("Zipped");
    expect(library.fileOrder).toEqual(["nested/content.xml"]);
  });
});
