import { descriptionToXml } from "./xmlBuilder.js";

export function buildHomebrewPreviewElement(element, collection) {
  return {
    name: element.name?.trim() || `New ${element.type}`,
    type: element.type,
    source: collection.name,
    description: descriptionToXml(element.description),
    prerequisite: element.prerequisite?.trim() || null,
    sheetDescription: element.sheetText?.trim()
      ? {
          entries: [
            {
              level: 1,
              description: element.sheetText.trim(),
            },
          ],
        }
      : null,
    ...(element.rawXml != null
      ? {
          previewNote:
            "Raw XML is shown using the last structured form values until it is loaded.",
        }
      : {}),
  };
}
