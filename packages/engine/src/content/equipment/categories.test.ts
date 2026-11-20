import { describe, expect, it } from "vitest";
import type { ParsedElement } from "../parser.js";
import {
  buildEquipmentCategories,
  equipmentMetadata,
  isPhysicalEquipment,
  publicEquipmentDescription,
  type EquipmentCategoryDto,
} from "./categories.js";
import { buildReviewedLibrary } from "./reviewed-profile.test-support.js";

function element(
  id: string,
  type: string,
  setters: Array<{ name: string; value: string }>,
): ParsedElement {
  return {
    identity: { id, name: id, type, source: "Test" },
    setters,
    rules: [],
    supports: [],
    compendiumHidden: false,
    sheets: [],
    children: [],
    declaredBy: "equipment.test.xml",
  } as ParsedElement;
}

describe("equipment category DTOs", () => {
  it("returns unique structured physical-equipment categories and excludes controls", () => {
    const categories = buildEquipmentCategories([
      element("gear", "Item", [{ name: "category", value: "Adventuring Gear" }]),
      element("sword", "Weapon", [{ name: "category", value: "Weapons" }]),
      element("plate", "Armor", [{ name: "category", value: "Armor" }]),
      element("magic-sword", "Magic Item", [
        { name: "category", value: "Magic Weapons" },
        { name: "weapon", value: "ID_INTERNAL_WEAPON_GROUP_SWORDS" },
      ]),
      element("magic-armor", "Magic Item", [
        { name: "category", value: "Magic Armor" },
        { name: "armor", value: "ID_INTERNAL_ARMOR_GROUP_HEAVY" },
      ]),
      element("control", "Item", [
        { name: "category", value: "Optional Class Features" },
      ]),
      element("hidden", "Item", [
        { name: "category", value: "Adventuring Gear" },
        { name: "inventory-hidden", value: "true" },
      ]),
    ]);

    expect(categories).toEqual<EquipmentCategoryDto[]>([
      {
        key: "item-adventuring-gear",
        label: "Adventuring Gear",
        elementType: "Item",
        itemCategory: "Adventuring Gear",
        equipSetter: null,
      },
      {
        key: "weapons",
        label: "Weapons",
        elementType: "Weapon",
        itemCategory: null,
        equipSetter: null,
      },
      {
        key: "armor",
        label: "Armor",
        elementType: "Armor",
        itemCategory: null,
        equipSetter: null,
      },
      {
        key: "magic-weapons",
        label: "Magic Weapons",
        elementType: "Magic Item",
        itemCategory: null,
        equipSetter: "weapon",
      },
      {
        key: "magic-armor",
        label: "Magic Armor",
        elementType: "Magic Item",
        itemCategory: null,
        equipSetter: "armor",
      },
    ]);
  });

  it("excludes adjustment proxies from the reviewed equipment surface", async () => {
    const library = await buildReviewedLibrary();
    const categories = buildEquipmentCategories(library.byId.values());

    expect(categories.some((category) => category.label === "Additional Feature")).toBe(false);
    expect(isPhysicalEquipment(library.byId.get("ID_INTERNAL_ITEM_PROXY_FAMILIAR_SELECTION")!)).toBe(false);
    expect(isPhysicalEquipment(library.byId.get("ID_PHB_INTERNAL_ITEM__SPELL_PROXY_SPELL_FOG_CLOUD")!)).toBe(false);
    expect(isPhysicalEquipment(library.byId.get("ID_DMG_INTERNAL_ITEM_PROFICIENCY_PROXY_PROFICIENCY_WEAPON_MODERN_FIREARMS_PISTOL_AUTOMATIC")!)).toBe(false);
    expect(isPhysicalEquipment(library.byId.get("ID_WOTC_PHB_WEAPON_LONGSWORD")!)).toBe(true);
    expect(isPhysicalEquipment(library.byId.get("ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER")!)).toBe(true);
    expect(isPhysicalEquipment(library.byId.get("ID_INTERNAL_MAGIC_ITEM_SPELL_SCROLL_GUIDANCE")!)).toBe(true);
  });

  it("exposes public item descriptions and metadata from content setters", async () => {
    const library = await buildReviewedLibrary();
    const longsword = library.byId.get("ID_WOTC_PHB_WEAPON_LONGSWORD")!;
    const staff = library.byId.get("ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER")!;

    const longswordMetadata = equipmentMetadata(longsword);
    const staffMetadata = equipmentMetadata(staff);
    expect(longswordMetadata.description).toContain("1d8 slashing");
    expect(longswordMetadata.description).toContain("Versatile (1d10)");
    expect(staffMetadata.description).toContain("Armor Class");
    expect(staffMetadata.rarity).toBe("Very Rare");
    expect(staffMetadata.attunement).toEqual({
      required: true,
      addition: "by a sorcerer, warlock, or wizard",
    });
  });
});

describe("equipment stat blocks", () => {
  const libraryPromise = buildReviewedLibrary();
  const resolverFor = (library: Awaited<typeof libraryPromise>) =>
    (id: string) => library.byId.get(id);

  it("publishes the armour class alongside an armour's authored prose", async () => {
    const library = await libraryPromise;
    const hide = library.byId.get("ID_WOTC_ARMOR_MEDIUM_HIDE_ARMOR")!;

    const description = publicEquipmentDescription(hide, resolverFor(library));

    // The stat the character sheet is built from must be visible, and the
    // authored flavour text must survive alongside it.
    expect(description).toContain("12 + Dex modifier (max 2)");
    expect(description).toContain("Medium");
    expect(description).toContain("This crude armor consists of thick furs");
    expect(description.indexOf("12 + Dex")).toBeLessThan(
      description.indexOf("This crude armor"),
    );
  });

  it("publishes an armour's strength requirement and stealth penalty", async () => {
    const library = await libraryPromise;
    const plate = library.byId.get("ID_WOTC_ARMOR_HEAVY_PLATE")!;

    const description = publicEquipmentDescription(plate, resolverFor(library));

    expect(description).toContain("Strength");
    expect(description).toContain("15");
    expect(description).toContain("Stealth");
    expect(description).toContain("Disadvantage");
  });

  it("names a weapon's properties and explains them", () => {
    // The property elements live outside the reviewed fixture profile, so the
    // resolver is stubbed to keep this about composition rather than corpus reach.
    const heavy = element("ID_INTERNAL_WEAPON_PROPERTY_HEAVY", "Weapon Property", []);
    heavy.identity.name = "Heavy";
    heavy.descriptionXml = "<p>Small creatures have disadvantage on attack rolls with heavy weapons.</p>";
    const twoHanded = element("ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED", "Weapon Property", []);
    twoHanded.identity.name = "Two-Handed";
    twoHanded.descriptionXml = "<p>This weapon requires two hands when you attack with it.</p>";
    const properties = new Map([
      [heavy.identity.id, heavy],
      [twoHanded.identity.id, twoHanded],
    ]);

    const greataxe = element("axe", "Weapon", [{ name: "damage", value: "1d12" }]);
    greataxe.setters[0]!.attrs = { type: "slashing" };
    greataxe.supports.push(heavy.identity.id, twoHanded.identity.id);

    const description = publicEquipmentDescription(greataxe, (id) => properties.get(id));

    expect(description).toContain("1d12 slashing");
    expect(description).toContain("Heavy, Two-Handed");
    expect(description).toContain("Small creatures have disadvantage");
    expect(description).toContain("requires two hands");
    // The property name is a run-in label inside the prose's own paragraph.
    // Wrapping the prose in a second <p> would nest paragraphs, which parsers
    // split back into a stray label line above unlabelled text.
    expect(description).toContain(
      '<p class="entry"><span class="feature">Heavy. </span>Small creatures',
    );
    expect(description).not.toMatch(/<p[^>]*>\s*<span[^>]*>[^<]*<\/span>\s*<p/);
  });

  it("groups the generated facts so they escape the prose indent", async () => {
    const library = await libraryPromise;
    const hide = library.byId.get("ID_WOTC_ARMOR_MEDIUM_HIDE_ARMOR")!;

    const description = publicEquipmentDescription(hide, resolverFor(library));

    expect(description).toMatch(/^<div class="stat-block">/);
    expect(description).toContain('<p class="stat-line">');
    expect(description).toContain("</div>");
    // Authored prose stays outside the block, after it.
    expect(description.indexOf("</div>")).toBeLessThan(
      description.indexOf("This crude armor"),
    );
  });

  it("keeps versatile damage on the weapon it belongs to", async () => {
    const library = await libraryPromise;
    const longsword = library.byId.get("ID_WOTC_PHB_WEAPON_LONGSWORD")!;

    const description = publicEquipmentDescription(longsword, resolverFor(library));

    // Versatile is named from its setter, so the notation survives even where
    // the property elements are not resolvable.
    expect(description).toContain("1d8 slashing");
    expect(description).toContain("Versatile (1d10)");
  });

  it("leaves elements that are neither weapon nor armour untouched", async () => {
    const library = await libraryPromise;
    const staff = library.byId.get("ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER")!;

    const description = publicEquipmentDescription(staff, resolverFor(library));

    expect(description).toBe(staff.descriptionXml);
  });

  it("works without a resolver, omitting only the property prose", () => {
    const axe = element("axe", "Weapon", [{ name: "damage", value: "1d12" }]);
    axe.supports.push("ID_INTERNAL_WEAPON_PROPERTY_HEAVY");

    const description = publicEquipmentDescription(axe);

    // An unresolved id is skipped rather than guessed at from its spelling.
    expect(description).toContain("1d12");
    expect(description).not.toContain("Heavy");
  });

  it("escapes authored setter values", () => {
    const armor = element("odd", "Armor", [
      { name: "armorClass", value: "11 + <Dex> & more" },
    ]);

    expect(publicEquipmentDescription(armor)).toContain(
      "11 + &lt;Dex&gt; &amp; more",
    );
  });

  it("rewrites a pack's omission note from its extras", () => {
    const pack = element("pack", "Item", [{ name: "category", value: "Equipment Packs" }]);
    pack.descriptionXml = `<p>You will receive:</p><p class="indent">• Mace</p><p><b>Note:</b> This pack doesn't include Chain Shirt, Shield, Holy Symbol and 7 GP.</p>`;
    pack.extras = {
      gold: 7,
      items: [
        { id: "chain-shirt", amount: 1 },
        { id: "shield", amount: 1 },
      ],
      choices: [{ label: "Holy Symbol", candidates: [{ id: "amulet", amount: 1 }] }],
    };
    const named = (id: string, name: string): ParsedElement => ({
      ...element(id, "Armor", []),
      identity: { id, name, type: "Armor", source: "Test" },
    });
    const resolve = (id: string): ParsedElement | undefined =>
      id === "chain-shirt" ? named(id, "Chain Shirt") : id === "shield" ? named(id, "Shield") : undefined;

    const description = publicEquipmentDescription(pack, resolve);

    expect(description).not.toContain("doesn't include");
    expect(description).toContain(
      "Extracting this pack also grants Chain Shirt, Shield and 7 GP, and offers a choice of Holy Symbol.",
    );
  });

  it("appends the extraction note when the prose has none", () => {
    const pack = element("pack", "Item", [{ name: "category", value: "Equipment Packs" }]);
    pack.descriptionXml = "<p>You will receive a Mace.</p>";
    pack.extras = { gold: 8, items: [], choices: [] };

    expect(publicEquipmentDescription(pack)).toBe(
      '<p>You will receive a Mace.</p><p><b>Note:</b> Extracting this pack also grants 8 GP.</p>',
    );
  });
});

describe("mounts and vehicles stat lines", () => {
  type Setter = { name: string; value: string; attrs?: Record<string, string> };
  function gear(name: string, setters: Setter[], descriptionXml?: string): ParsedElement {
    const item = element(`ID_TEST_ITEM_${name.toUpperCase().replace(/\W+/g, "_")}`, "Item", [
      { name: "category", value: "Mounts & Vehicles" },
      ...setters,
    ]);
    item.identity.name = name;
    item.descriptionXml = descriptionXml;
    return item;
  }

  it("shows a vehicle's type, cost and weight when it has no description", () => {
    const wagon = gear("Test Wagon", [
      { name: "cost", value: "42", attrs: { currency: "gp" } },
      { name: "weight", value: "450 lb.", attrs: { lb: "450", excludeEncumbrance: "true" } },
      { name: "type", value: "Vehicle" },
    ], "<p></p>");

    expect(publicEquipmentDescription(wagon)).toBe(
      '<div class="stat-block">' +
        '<p class="stat-line"><span class="feature">Type. </span>Vehicle</p>' +
        '<p class="stat-line"><span class="feature">Cost. </span>42 gp</p>' +
        '<p class="stat-line"><span class="feature">Weight. </span>450 lb.</p>' +
        "</div>",
    );
  });

  it("includes only the facts present, and treats a missing description as empty", () => {
    const feed = gear("Test Fodder", [
      { name: "cost", value: "3", attrs: { currency: "cp" } },
      { name: "weight", value: "7 lb.", attrs: { lb: "7" } },
      { name: "stackable", value: "true" },
    ]);

    const description = publicEquipmentDescription(feed);

    expect(description).toContain("<span class=\"feature\">Cost. </span>3 cp");
    expect(description).toContain("<span class=\"feature\">Weight. </span>7 lb.");
    expect(description).not.toContain("Type.");
    expect(description).not.toContain("stackable");
  });

  it("leaves out a zero weight, a dash weight and a zero cost", () => {
    const lodging = gear("Test Paddock", [
      { name: "cost", value: "2", attrs: { currency: "sp" } },
      { name: "weight", value: "0 lb.", attrs: { lb: "0" } },
    ]);
    const unpriced = gear("Test Raft", [
      { name: "cost", value: "0", attrs: { currency: "gp" } },
      { name: "weight", value: "—", attrs: { lb: "0" } },
      { name: "type", value: "Vehicle" },
    ]);

    expect(publicEquipmentDescription(lodging)).toBe(
      '<div class="stat-block"><p class="stat-line"><span class="feature">Cost. </span>2 sp</p></div>',
    );
    expect(publicEquipmentDescription(unpriced)).toBe(
      '<div class="stat-block"><p class="stat-line"><span class="feature">Type. </span>Vehicle</p></div>',
    );
  });

  it("keeps a real description instead of the generated line", () => {
    const sledge = gear("Test Sledge", [
      { name: "cost", value: "12", attrs: { currency: "gp" } },
      { name: "type", value: "Vehicle" },
    ], "<p>A made-up sledge for testing.</p>");

    expect(publicEquipmentDescription(sledge)).toBe("<p>A made-up sledge for testing.</p>");
  });

  it("keeps an expanded reference description, and never replaces an unexpanded one", () => {
    const beast = gear("Test Beast", [
      { name: "cost", value: "9", attrs: { currency: "gp" } },
      { name: "type", value: "Mount" },
    ], '<div class="reference"><div element="ID_TEST_INFORMATION_BEAST" /></div>');

    expect(publicEquipmentDescription(beast, undefined, "<h5>TEST BEAST</h5><p>Made-up stats.</p>"))
      .toBe("<h5>TEST BEAST</h5><p>Made-up stats.</p>");
    expect(publicEquipmentDescription(beast)).not.toContain("stat-line");
    // An expansion that found nothing is empty, so the facts fill the panel.
    expect(publicEquipmentDescription(beast, undefined, '<div class="reference"></div>')).toContain("Cost. </span>9 gp");
  });

  it("escapes setter values", () => {
    const odd = gear("Test Odd", [{ name: "type", value: "Cart <Big> & Co" }]);

    expect(publicEquipmentDescription(odd)).toContain("Cart &lt;Big&gt; &amp; Co");
  });

  it("does not touch other categories or element types", () => {
    const rope = element("rope", "Item", [
      { name: "category", value: "Adventuring Gear" },
      { name: "cost", value: "1", attrs: { currency: "gp" } } as Setter,
    ]);
    const charm = element("charm", "Magic Item", [
      { name: "category", value: "Mounts & Vehicles" },
      { name: "cost", value: "1", attrs: { currency: "gp" } } as Setter,
    ]);

    expect(publicEquipmentDescription(rope)).toBe("");
    expect(publicEquipmentDescription(charm)).toBe("");
  });

  it("reaches the equipment metadata used by the inventory", () => {
    const cart = gear("Test Handcart", [
      { name: "cost", value: "5", attrs: { currency: "gp" } },
      { name: "type", value: "Vehicle" },
    ]);

    expect(equipmentMetadata(cart).description).toContain("Type. </span>Vehicle");
  });
});
