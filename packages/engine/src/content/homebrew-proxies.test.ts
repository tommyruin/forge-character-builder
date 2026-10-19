/**
 * The "Additional X" items that let Manage > Additional features switch a
 * language, proficiency, feat or ability score improvement on for a character
 * are generated at ingest. A homebrew pack's elements get the same items, so a
 * DM can hand one to a character without a custom feature around it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "./library.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";

const LANGUAGE = "ID_HB_PROXY_LANGUAGE_TIDECANT";
const PROFICIENCY = "ID_HB_PROXY_PROFICIENCY_RUNE_LORE";
const FEAT = "ID_HB_PROXY_FEAT_SALT_SENSE";
const ASI = "ID_HB_PROXY_ASI_SALT";
const BOOK_ONLY_LANGUAGE = "ID_PLAIN_PROXY_LANGUAGE_NOTHOMEBREW";

// Invented content. The first source is marked homebrew; the second is an
// ordinary upload with no homebrew mark and so no slug to build a proxy id from.
const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Proxy Pack" type="Source" source="Proxy Pack" id="ID_HB_PROXY_SOURCE_PACK">
    <description><p>Homebrew.</p></description>
    <setters><set name="abbreviation">PP</set><set name="url">https://local.homebrew</set><set name="homebrew">true</set></setters>
  </element>
  <element name="Tidecant" type="Language" source="Proxy Pack" id="${LANGUAGE}">
    <supports>Standard</supports>
    <description><p>The speech of the tides.</p></description>
  </element>
  <element name="Rune Lore" type="Proficiency" source="Proxy Pack" id="${PROFICIENCY}">
    <supports>Tool</supports>
    <description><p>Reading carved signs.</p></description>
  </element>
  <element name="Salt Sense" type="Feat" source="Proxy Pack" id="${FEAT}">
    <description><p>You smell the sea.</p></description>
    <rules><stat name="initiative" value="1" /></rules>
  </element>
  <element name="Salt" type="Ability Score Improvement" source="Proxy Pack" id="${ASI}">
    <description><p>Brine toughens you.</p></description>
    <rules><stat name="constitution" value="1" /></rules>
  </element>
</elements>`;

const PLAIN = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Plain Tongue" type="Language" source="Plain Upload" id="${BOOK_ONLY_LANGUAGE}">
    <supports>Standard</supports>
    <description><p>Not homebrew.</p></description>
  </element>
</elements>`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(
    library,
    new Map([
      ...(base.fileContents ?? []),
      ["imports/proxy-pack.xml", PACK],
      ["imports/plain-upload.xml", PLAIN],
    ]),
  );
}, 120_000);

const proxyFor = (grantedId: string) =>
  [...library.byId.values()].find(
    (element) =>
      element.identity.type === "Item" &&
      element.rules.some((rule) => rule.kind === "grant" && rule.id === grantedId),
  );

describe("proxies for a homebrew pack", () => {
  it.each([
    [LANGUAGE, "Additional Language, Tidecant", "Additional Language"],
    [PROFICIENCY, "Additional Proficiency, Rune Lore", "Additional Proficiency"],
    [FEAT, "Additional Feat, Salt Sense", "Additional Feature"],
    [ASI, "Additional Ability Score Improvement, Salt", "Additional Feature"],
  ])("makes an Additional item for %s that Manage lists under %s", (grantedId, name, category) => {
    const proxy = proxyFor(grantedId);
    expect(proxy).toBeDefined();
    expect(proxy!.identity).toMatchObject({ name, type: "Item", source: "Proxy Pack" });
    expect(proxy!.setters.find((setter) => setter.name === "category")?.value).toBe(category);
  });

  it("makes none for an upload that is not marked homebrew", () => {
    expect(proxyFor(BOOK_ONLY_LANGUAGE)).toBeUndefined();
  });

  it("lists the proxies in Additional features and switches the granted element on and off", () => {
    const { service, id } = buildFighter3(library, "ProxyFighter");
    const entry = (grantedId: string) => {
      const proxy = proxyFor(grantedId)!;
      return service.getCharacterAdjustments(id).find((adjustment) => adjustment.elementId === proxy.identity.id);
    };
    expect(entry(LANGUAGE)).toMatchObject({ name: "Additional Language, Tidecant", category: "Additional Language", enabled: false });

    const registered = (): string[] => service.getCharacter(id).sum.elements.map((element) => element.id);
    expect(registered()).not.toContain(LANGUAGE);
    const key = entry(LANGUAGE)!.key;
    service.setCharacterControl(id, { key, enabled: true });
    expect(registered()).toContain(LANGUAGE);
    expect(entry(LANGUAGE)!.enabled).toBe(true);
    service.setCharacterControl(id, { key, enabled: false });
    expect(registered()).not.toContain(LANGUAGE);

    const feat = entry(FEAT)!;
    service.setCharacterControl(id, { key: feat.key, enabled: true });
    expect(registered()).toContain(FEAT);
  });

  it("keeps the proxies out of the character's inventory", () => {
    const { service, id } = buildFighter3(library, "ProxyInventory");
    const key = service.getCharacterAdjustments(id).find((adjustment) => adjustment.elementId === proxyFor(LANGUAGE)!.identity.id)!.key;
    service.setCharacterControl(id, { key, enabled: true });
    const items = (service.getInventory(id) as unknown as { items: Array<{ itemId: string }> }).items;
    expect(items.some((item) => item.itemId === proxyFor(LANGUAGE)!.identity.id)).toBe(false);
  });
});

describe("proxies for the shipped books", () => {
  it("are unchanged: a book proxy carries no category of its own", () => {
    const book = [...library.byId.values()].find(
      (element) => element.identity.type === "Item" && element.identity.id.startsWith("ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_"),
    );
    if (book !== undefined) expect(book.setters.find((setter) => setter.name === "category")).toBeUndefined();
  });
});
