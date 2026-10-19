import { describe, expect, it } from "vitest";
import { linkedCustomIds } from "./promote.js";
import {
  createCustomClassDraft,
  createCustomDraft,
  createCustomItemDraft,
  createCustomSubclassDraft,
  newCustomBlockId,
  type CustomBlock,
} from "./schema.js";

const grant = (id: string, type = "Custom Feature"): CustomBlock => ({ kind: "grant", id: newCustomBlockId(), target: { by: "id", type, id } });

describe("the elements a draft refers to", () => {
  it("lists what an item grants", () => {
    const item = { ...createCustomItemDraft("worn", "Lantern"), slot: "misc" as const, blocks: [grant("ID_CUSTOM_AAAA1111")] };
    expect(linkedCustomIds(item)).toEqual(["ID_CUSTOM_AAAA1111"]);
  });

  it("lists each id once, and skips book ids", () => {
    const feature = { ...createCustomDraft("boon", "Gift"), blocks: [grant("ID_CUSTOM_AAAA1111"), grant("ID_CUSTOM_AAAA1111"), grant("ID_PHB_FEAT_ALERT", "Feat")] };
    expect(linkedCustomIds(feature)).toEqual(["ID_CUSTOM_AAAA1111"]);
  });

  it("lists a pick filter that names an element, and a subclass's class", () => {
    const pick: CustomBlock = {
      kind: "choice",
      id: newCustomBlockId(),
      type: "Feat",
      name: "Gift",
      count: 1,
      supports: { kind: "group", op: "any", items: [{ kind: "id", value: "ID_CUSTOM_BBBB2222" }] },
    };
    expect(linkedCustomIds({ ...createCustomDraft("boon", "Gift"), blocks: [pick] })).toEqual(["ID_CUSTOM_BBBB2222"]);
    const subclass = createCustomSubclassDraft({ id: "ID_CUSTOM_CLASS0001", name: "Tide Warden", tag: "Tide Warden" }, "Wave Order");
    expect(linkedCustomIds(subclass)).toEqual(["ID_CUSTOM_CLASS0001"]);
  });

  it("does not list a feature a class carries inside itself", () => {
    const inner = createCustomDraft("feature", "Inner");
    const klass = { ...createCustomClassDraft("Tide Warden"), features: [{ level: 1, draft: { ...inner, showsUnder: "class" as const, blocks: [grant("ID_CUSTOM_DDDD4444")] } }] };
    expect(linkedCustomIds(klass)).toEqual(["ID_CUSTOM_DDDD4444"]);
    expect(linkedCustomIds(klass)).not.toContain(inner.id);
  });
});
