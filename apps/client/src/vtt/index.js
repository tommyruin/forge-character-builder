// VTT export entry points. Each collects the export model from the engine, builds the
// target-specific JSON, and returns { filename, blob } ready for download — mirroring the
// shape of api.characters.export so the UI treats all export kinds uniformly.
import { collectExportModel } from "./collect.js";
import { buildFoundryActor } from "./foundry/buildActor.js";
import { buildVttes } from "./roll20/buildVttes.js";

function jsonBlob(value) {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
}

function safeName(name, id) {
  const base = (name || id || "character")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "character";
}

export async function exportFoundry(id, opts = {}) {
  const model = await collectExportModel(id, opts);
  const actor = buildFoundryActor(model);
  return {
    filename: `${safeName(model.meta.name, id)}.foundry.json`,
    blob: jsonBlob(actor),
    data: actor,
  };
}

export async function exportRoll20(id, opts = {}) {
  const model = await collectExportModel(id, opts);
  if (model.meta.ruleset === "2024") {
    throw new Error(
      "Roll20 export currently supports 2014 rules characters only. " +
        "Use Foundry or the portable character file for a 2024 character.",
    );
  }
  const vttes = buildVttes(model);
  return {
    filename: `${safeName(model.meta.name, id)}.roll20.json`,
    blob: jsonBlob(vttes),
    data: vttes,
  };
}

export { collectExportModel };
