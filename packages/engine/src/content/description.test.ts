import { describe, expect, it } from "vitest";
import { descriptionToText } from "./description.js";

describe("descriptionToText", () => {
  it("keeps paragraphs, list items and table rows on their own lines", () => {
    const xml = `
      <p>You have a safe place.</p>
      <p>Others know &amp; respect it.</p>
      <ul><li>Shelter</li><li>A <em>hot</em> meal</li></ul>
      <table><thead><tr><td>Activity</td><td>DC</td></tr></thead><tr><td>Find plants</td><td>15</td></tr></table>`;
    expect(descriptionToText(xml)).toBe(
      "You have a safe place.\n\nOthers know & respect it.\n\n• Shelter\n• A hot meal\n\nActivity | DC\nFind plants | 15",
    );
  });

  it("is empty for nothing and never leaves markup behind", () => {
    expect(descriptionToText(undefined)).toBe("");
    expect(descriptionToText("<p> </p><!-- note -->")).toBe("");
    expect(descriptionToText("<div>One<br/>Two</div>")).toBe("One\nTwo");
  });
});
