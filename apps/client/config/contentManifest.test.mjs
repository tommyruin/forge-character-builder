import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectBundledFiles, collectCorpusXml, corpusContentManifestPlugin, createContentManifest } from "./contentManifest.mjs";

// The reviewed-test profile lists files of the content corpus, which a fresh
// clone fetches separately (npm run corpus:fetch); without it the check skips.
const CORPUS_ROOT = fileURLToPath(new URL("../../../third-party/elements/", import.meta.url));
const corpusPresent = existsSync(join(CORPUS_ROOT, "testdata"));
const PUBLIC_ROOT = fileURLToPath(new URL("../public/content/", import.meta.url));
const SYSTEM_ROOT = join(PUBLIC_ROOT, "system");

function registerDevMiddleware(options) {
  let middleware;
  corpusContentManifestPlugin(options).configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  return middleware;
}

function request(middleware, url, method = "GET") {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const response = {
      statusCode: 200,
      setHeader(name, value) {
        headers.set(name.toLowerCase(), value);
      },
      end(body = "") {
        resolve({
          body: Buffer.from(body),
          headers,
          next: false,
          statusCode: response.statusCode,
        });
      },
    };
    const next = (error) => resolve({ error, headers, next: true, statusCode: response.statusCode });
    Promise.resolve(middleware({ headers: {}, method, url }, response, next)).catch(reject);
  });
}

describe("browser corpus manifest", () => {
  it("keeps deterministic base-path URLs and integrity metadata", () => {
    const manifest = createContentManifest(
      [{ path: "system/system-elements.xml", bytes: new Uint8Array([1, 2]), sha256: "abc" }],
      "/tools/character-builder/",
    );
    expect(manifest).toMatchObject({ version: 1, source: "apps/client/public/content" });
    expect(manifest.files).toEqual([
      {
        path: "system/system-elements.xml",
        url: "/tools/character-builder/content/system/system-elements.xml",
        sha256: "abc",
        bytes: 2,
      },
    ]);
  });

  it("serves decoded XML and the manifest from the dev content subtree", async () => {
    const root = await mkdtemp(join(tmpdir(), "fcb-content-manifest-"));
    try {
      const xml = "<elements><element name=\"fixture\" /></elements>";
      await mkdir(join(root, "rules"));
      await writeFile(join(root, "rules", "fixture.xml"), xml);
      const middleware = registerDevMiddleware({
        basePath: "/tools/character-builder/",
        corpusRoot: root,
        profile: "full",
      });

      const manifestResponse = await request(
        middleware,
        "/tools/character-builder/content/manifest.json",
      );
      expect(manifestResponse.next).toBe(false);
      expect(manifestResponse.statusCode).toBe(200);
      expect(manifestResponse.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(JSON.parse(manifestResponse.body.toString())).toMatchObject({
        profile: "full",
        files: [
          {
            path: "rules/fixture.xml",
            url: "/tools/character-builder/content/rules/fixture.xml",
          },
        ],
      });

      const xmlResponse = await request(
        middleware,
        "/tools/character-builder/content/rules%2Ffixture.xml",
      );
      expect(xmlResponse.next).toBe(false);
      expect(xmlResponse.statusCode).toBe(200);
      expect(xmlResponse.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      expect(xmlResponse.body.toString()).toBe(xml);

      const unknownResponse = await request(
        middleware,
        "/tools/character-builder/content/rules/missing.xml",
      );
      expect(unknownResponse.next).toBe(false);
      expect(unknownResponse.statusCode).toBe(404);

      const traversalResponse = await request(
        middleware,
        "/tools/character-builder/content/%2e%2e/secret.xml",
      );
      expect(traversalResponse.next).toBe(false);
      expect(traversalResponse.statusCode).toBe(404);

      const unrelatedResponse = await request(middleware, "/tools/character-builder/");
      expect(unrelatedResponse.next).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("defaults to the public-base profile and excludes anything outside the shipped baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "fcb-content-profile-"));
    try {
      await mkdir(join(root, "testdata", "core", "players-handbook", "classes"), { recursive: true });
      await mkdir(join(root, "testdata", "supplements"), { recursive: true });
      await mkdir(join(root, "core"), { recursive: true });
      await writeFile(join(root, "core", "conditions.xml"), "<elements />");
      await writeFile(
        join(root, "testdata", "core", "players-handbook", "classes", "class-fighter.xml"),
        "<elements />",
      );
      await writeFile(join(root, "testdata", "supplements", "extra.xml"), "<elements />");
      await mkdir(join(root, "system"), { recursive: true });
      await writeFile(join(root, "system", "system-proxies.xml"), "<elements />");
      const middleware = registerDevMiddleware({ corpusRoot: root, basePath: "/" });
      const response = await request(
        middleware,
        "/content/manifest.json",
      );
      expect(JSON.parse(response.body.toString())).toMatchObject({
        profile: "public-base",
        files: [
          { path: "core/conditions.xml" },
          { path: "system/system-proxies.xml" },
        ],
      });
      expect(JSON.parse(response.body.toString()).files).toHaveLength(2);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("adds the system elements to a corpus-style root, filtered by the profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "fcb-content-corpus-"));
    const systemRoot = await mkdtemp(join(tmpdir(), "fcb-content-system-"));
    try {
      await mkdir(join(root, "testdata", "core"), { recursive: true });
      await writeFile(join(root, "testdata", "core", "internal.xml"), "<elements />");
      const systemXml = "<elements><element name=\"system\" /></elements>";
      for (const name of ["system-elements.xml", "system-elements-extended.xml", "system-proxies.xml"]) {
        await writeFile(join(systemRoot, name), systemXml);
      }
      await writeFile(join(systemRoot, "notes.txt"), "not content");

      const middleware = registerDevMiddleware({ corpusRoot: root, systemRoot, basePath: "/", profile: "full" });
      const manifest = JSON.parse((await request(middleware, "/content/manifest.json")).body.toString());
      expect(manifest.files.map(({ path }) => path)).toEqual([
        "testdata/core/internal.xml",
        "system/system-elements-extended.xml",
        "system/system-elements.xml",
        "system/system-proxies.xml",
      ]);
      const served = await request(middleware, "/content/system/system-proxies.xml");
      expect(served.statusCode).toBe(200);
      expect(served.body.toString()).toBe(systemXml);

      // reviewed-test names its system files; the extended identities are not among them.
      const reviewed = await collectBundledFiles(root, "reviewed-test", systemRoot);
      expect(reviewed.map(({ path }) => path)).toEqual([
        "testdata/core/internal.xml",
        "system/system-elements.xml",
        "system/system-proxies.xml",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(systemRoot, { force: true, recursive: true });
    }
  });

  it("keeps the public-base set unchanged when the system root is the shipped one", async () => {
    const plain = await collectBundledFiles(PUBLIC_ROOT);
    const withSystem = await collectBundledFiles(PUBLIC_ROOT, "public-base", SYSTEM_ROOT);
    expect(withSystem.map(({ path, sha256 }) => `${path}:${sha256}`)).toEqual(
      plain.map(({ path, sha256 }) => `${path}:${sha256}`),
    );
  });

  it("pins the public-base path set and digest", async () => {
    const root = fileURLToPath(new URL("../../../apps/client/public/content/", import.meta.url));
    const files = await collectBundledFiles(root);
    const paths = files.map(({ path }) => path);
    expect(paths).toEqual([
      "core/ability-score-increase.xml",
      "core/alignments.xml",
      "core/conditions.xml",
      "core/damage-types.xml",
      "core/experimental.xml",
      "core/internal/grants.xml",
      "core/internal/multiclassing.xml",
      "core/internal/options.xml",
      "core/internal/sources.xml",
      "core/internal/supports.xml",
      "core/internal/templates.xml",
      "core/languages.xml",
      "core/levels.xml",
      "core/proficiencies/armor.xml",
      "core/proficiencies/saving-throws.xml",
      "core/proficiencies/skill-expertise.xml",
      "core/proficiencies/skill-internal.xml",
      "core/proficiencies/skills.xml",
      "core/proficiencies/spellcasting-focus.xml",
      "core/proficiencies/tools-artisans.xml",
      "core/proficiencies/tools-gaming-sets.xml",
      "core/proficiencies/tools-kits.xml",
      "core/proficiencies/tools-misc.xml",
      "core/proficiencies/tools-musical-instruments.xml",
      "core/proficiencies/weapons.xml",
      "core/properties/armor.xml",
      "core/properties/firearms.xml",
      "core/properties/tools.xml",
      "core/properties/weapons.xml",
      "core/size.xml",
      "core/vision.xml",
      "srd-5.1/archetypes/barbarian-berserker.xml",
      "srd-5.1/archetypes/bard-lore.xml",
      "srd-5.1/archetypes/cleric-life.xml",
      "srd-5.1/archetypes/druid-land.xml",
      "srd-5.1/archetypes/fighter-champion.xml",
      "srd-5.1/archetypes/monk-open-hand.xml",
      "srd-5.1/archetypes/paladin-devotion.xml",
      "srd-5.1/archetypes/ranger-hunter.xml",
      "srd-5.1/archetypes/rogue-thief.xml",
      "srd-5.1/archetypes/sorcerer-draconic.xml",
      "srd-5.1/archetypes/warlock-fiend.xml",
      "srd-5.1/archetypes/wizard-evocation.xml",
      "srd-5.1/backgrounds/background-acolyte.xml",
      "srd-5.1/classes/class-barbarian.xml",
      "srd-5.1/classes/class-bard.xml",
      "srd-5.1/classes/class-cleric.xml",
      "srd-5.1/classes/class-druid.xml",
      "srd-5.1/classes/class-fighter.xml",
      "srd-5.1/classes/class-monk.xml",
      "srd-5.1/classes/class-paladin.xml",
      "srd-5.1/classes/class-ranger.xml",
      "srd-5.1/classes/class-rogue.xml",
      "srd-5.1/classes/class-sorcerer.xml",
      "srd-5.1/classes/class-warlock.xml",
      "srd-5.1/classes/class-wizard.xml",
      "srd-5.1/companions.xml",
      "srd-5.1/deities.xml",
      "srd-5.1/eldritch-invocations.xml",
      "srd-5.1/feats.xml",
      "srd-5.1/internal.xml",
      "srd-5.1/items/items-armor.xml",
      "srd-5.1/items/items-gear.xml",
      "srd-5.1/items/items-instrument.xml",
      "srd-5.1/items/items-mounts.xml",
      "srd-5.1/items/items-packs.xml",
      "srd-5.1/items/items-tools.xml",
      "srd-5.1/items/items-weapons.xml",
      "srd-5.1/items/magic/items-armor.xml",
      "srd-5.1/items/magic/items-poison.xml",
      "srd-5.1/items/magic/items-potions.xml",
      "srd-5.1/items/magic/items-rings.xml",
      "srd-5.1/items/magic/items-rods.xml",
      "srd-5.1/items/magic/items-staffs.xml",
      "srd-5.1/items/magic/items-wands.xml",
      "srd-5.1/items/magic/items-weapons.xml",
      "srd-5.1/items/magic/items-wondrous.xml",
      "srd-5.1/races/race-dragonborn.xml",
      "srd-5.1/races/race-dwarf.xml",
      "srd-5.1/races/race-elf.xml",
      "srd-5.1/races/race-gnome.xml",
      "srd-5.1/races/race-halfelf.xml",
      "srd-5.1/races/race-halfling.xml",
      "srd-5.1/races/race-halforc.xml",
      "srd-5.1/races/race-human.xml",
      "srd-5.1/races/race-tiefling.xml",
      "srd-5.1/ranger-favored-terrains.xml",
      "srd-5.1/spells.xml",
      "srd-5.2.1/archetypes/barbarian-berserker.xml",
      "srd-5.2.1/archetypes/bard-lore.xml",
      "srd-5.2.1/archetypes/cleric-life.xml",
      "srd-5.2.1/archetypes/druid-land.xml",
      "srd-5.2.1/archetypes/fighter-champion.xml",
      "srd-5.2.1/archetypes/monk-open-hand.xml",
      "srd-5.2.1/archetypes/paladin-devotion.xml",
      "srd-5.2.1/archetypes/ranger-hunter.xml",
      "srd-5.2.1/archetypes/rogue-thief.xml",
      "srd-5.2.1/archetypes/sorcerer-draconic.xml",
      "srd-5.2.1/archetypes/warlock-fiend.xml",
      "srd-5.2.1/archetypes/wizard-evoker.xml",
      "srd-5.2.1/backgrounds/background-acolyte.xml",
      "srd-5.2.1/backgrounds/background-criminal.xml",
      "srd-5.2.1/backgrounds/background-sage.xml",
      "srd-5.2.1/backgrounds/background-soldier.xml",
      "srd-5.2.1/classes/class-barbarian.xml",
      "srd-5.2.1/classes/class-bard.xml",
      "srd-5.2.1/classes/class-cleric.xml",
      "srd-5.2.1/classes/class-druid.xml",
      "srd-5.2.1/classes/class-fighter.xml",
      "srd-5.2.1/classes/class-monk.xml",
      "srd-5.2.1/classes/class-paladin.xml",
      "srd-5.2.1/classes/class-ranger.xml",
      "srd-5.2.1/classes/class-rogue.xml",
      "srd-5.2.1/classes/class-sorcerer.xml",
      "srd-5.2.1/classes/class-warlock.xml",
      "srd-5.2.1/classes/class-wizard.xml",
      "srd-5.2.1/classes/eldritch-invocations.xml",
      "srd-5.2.1/companions.xml",
      "srd-5.2.1/feats/feats-epic-boons.xml",
      "srd-5.2.1/feats/feats-fighting-styles.xml",
      "srd-5.2.1/feats/feats-general.xml",
      "srd-5.2.1/feats/feats-origin.xml",
      "srd-5.2.1/internal.xml",
      "srd-5.2.1/items/items-armor.xml",
      "srd-5.2.1/items/items-gear.xml",
      "srd-5.2.1/items/items-mounts-vehicles.xml",
      "srd-5.2.1/items/items-packs.xml",
      "srd-5.2.1/items/items-tools.xml",
      "srd-5.2.1/items/items-weapons.xml",
      "srd-5.2.1/misc/languages.xml",
      "srd-5.2.1/misc/proficiencies.xml",
      "srd-5.2.1/misc/weapon-mastery-properties.xml",
      "srd-5.2.1/races/race-dragonborn.xml",
      "srd-5.2.1/races/race-dwarf.xml",
      "srd-5.2.1/races/race-elf.xml",
      "srd-5.2.1/races/race-gnome.xml",
      "srd-5.2.1/races/race-goliath.xml",
      "srd-5.2.1/races/race-halfling.xml",
      "srd-5.2.1/races/race-human.xml",
      "srd-5.2.1/races/race-orc.xml",
      "srd-5.2.1/races/race-tiefling.xml",
      "srd-5.2.1/rules.xml",
      "srd-5.2.1/skill-expertise.xml",
      "srd-5.2.1/skill-supports.xml",
      "srd-5.2.1/source.xml",
      "srd-5.2.1/spells.xml",
      "system/system-proxies.xml",
      "system/system-unarmed-riders.xml",
    ]);
    expect(files).toHaveLength(148);
    expect(files.reduce((total, file) => total + file.bytes.byteLength, 0)).toBe(3695066);
    const manifest = createContentManifest(files);
    expect(manifest.source).toBe("apps/client/public/content");
    expect(manifest.sourceCategories).toEqual([
      "Core",
      "Internal",
      "Player’s Handbook",
      "Player’s Handbook (2024)",
      "System Reference Document",
    ]);
    expect(manifest.digest).toBe("ceb5dfd9fc4750afc3ea7629f9240425b0f56a4ba3305fda2d7ef26b3340b4cc");
    expect(createHash("sha256").update(paths.join("\n")).digest("hex"))
      .toBe("6f8117ec7b37687b7cb4655584cd814783c1b9fb74132d241cb03859918771dc");
    // The raw corpus tree is never bundled.
    expect(paths.some((path) => /(^|\/)(one-grung|xanathars|dungeon-masters-guide|monster-manual|players-handbook-2024|supplements|ua|unearthed-arcana)(\/|\.|$)/i.test(path))).toBe(false);
  });

  it.skipIf(!corpusPresent)("keeps the broad fixture compatibility set under the explicit reviewed-test profile", async () => {
    // The corpus root holds testdata only; the system elements ship under
    // apps/client/public/content/system and are collected from there.
    const corpus = await collectCorpusXml(CORPUS_ROOT, "reviewed-test");
    expect(corpus).toHaveLength(52);
    expect(corpus.some(({ path }) => path.startsWith("system/"))).toBe(false);
    const files = await collectBundledFiles(CORPUS_ROOT, "reviewed-test", SYSTEM_ROOT);
    const paths = files.map(({ path }) => path);
    expect(paths).toHaveLength(55);
    expect(paths.slice(52)).toEqual([
      "system/system-elements.xml",
      "system/system-proxies.xml",
      "system/system-unarmed-riders.xml",
    ]);
    expect(paths).toEqual(expect.arrayContaining([
      "testdata/supplements/extra-life/one-grung-above.xml",
      "testdata/supplements/xanathars-guide-to-everything/source.xml",
      "testdata/core/dungeon-masters-guide/items/items-wondrous.xml",
      "testdata/core/monster-manual/source.xml",
    ]));
  });
});
