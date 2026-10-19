/**
 * The brief notes for tools and useful gear: the structure of an item's
 * description decides what survives, not its first sentence.
 */

import { describe, expect, it } from "vitest";
import { itemNote, NOTE_BUDGET, USES_BUDGET } from "./item-summary.js";

const NAVIGATORS_2024 = `
  <ul class="unstyled">
    <li style="margin-bottom:-1em"><strong>Ability:</strong> Wisdom</li>
    <li style="text-align:right; margin-top:-1em"><strong>Weight:</strong> 2 lb.</li>
    <li><strong>Utilize:</strong> Plot a course (DC 10), or determine position by stargazing (DC 15)</li>
  </ul>`;

const CALTROPS_2024 = `<p>As a Utilize action, you can spread Caltrops from their bag to cover a 5-foot-square area within 5 feet of yourself. A creature that enters this area for the first time on a turn must succeed on a DC 15 Dexterity saving throw or take 1 Piercing damage and have its Speed reduced to 0 until the start of its next turn. It takes 10 minutes to recover the Caltrops.</p>`;

const OIL_2024 = `
  <p>You can douse a creature, object, or space with Oil or use it as fuel, as detailed below.</p>
  <p class="indent"><b><i>Dousing a Creature or an Object.</i></b> When you take the Attack action, you can replace one of your attacks with throwing an Oil flask. Target one creature or object within 20 feet of yourself. The target must succeed on a Dexterity saving throw (DC 8 plus your Dexterity modifier and Proficiency Bonus) or be covered in oil. If the target takes Fire damage before the oil dries (after 1 minute), the target takes an extra 5 Fire damage from burning oil.</p>
  <p class="indent"><b><i>Dousing a Space.</i></b> You can take the Utilize action to pour an Oil flask on level ground to cover a 5-foot square area within 5 feet of yourself. If lit, the oil burns until the end of the turn 2 rounds from when the oil was lit (or 12 seconds) and deals 5 Fire damage to any creature that enters the area or ends its turn there. A creature can take this damage only once per turn.</p>
  <p class="indent"><b><i>Fuel.</i></b> Oil serves as fuel for Lamps and Lanterns. Once lit, a flask of Oil burns for 6 hours in a Lamp or Lantern.</p>`;

const NAVIGATORS_2014 = `
  <p>Proficiency with navigator's tools helps you determine a true course based on observing the stars.</p>
  <p class="indent"><strong><em>Components.</em></strong> Navigator’s tools include a sextant, a compass, calipers, a ruler, parchment, ink, and a quill.</p>
  <p class="indent"><strong><em>Survival.</em></strong> Knowledge of navigator’s tools helps you avoid becoming lost.</p>
  <h5>NAVIGATOR’S TOOLS</h5>
  <table>
    <thead><tr><td>Activity</td><td class="col-10">DC</td></tr></thead>
    <tr><td>Plot a course</td><td>10</td></tr>
    <tr><td>Discover your position on a nautical chart</td><td>15</td></tr>
  </table>`;

describe("itemNote", () => {
  it("keeps a tool's ability and what it can be used for, and leaves the weight to the table", () => {
    const note = itemNote(NAVIGATORS_2024)!;
    expect(note.text).toBe("Ability: Wisdom. Utilize: Plot a course (DC 10), or determine position by stargazing (DC 15).");
    expect(note.html).toBe(
      "<p><strong>Ability:</strong> Wisdom.</p>" +
        "<p><strong>Utilize:</strong> Plot a course (DC 10), or determine position by stargazing (DC 15).</p>",
    );
    expect(note.text).not.toMatch(/weight|lb\./i);
  });

  it("keeps the save, the damage and the Speed effect from a long trap description", () => {
    const note = itemNote(CALTROPS_2024)!;
    expect(note.text).toContain("DC 15 Dexterity saving throw");
    expect(note.text).toContain("1 Piercing damage");
    expect(note.text).toContain("Speed reduced to 0");
  });

  it("keeps every headed use of an item, each under its heading, and drops the pointer to text it leaves out", () => {
    const note = itemNote(OIL_2024)!;
    expect(note.text.length).toBeLessThanOrEqual(USES_BUDGET);
    for (const heading of ["Dousing a Creature or an Object.", "Dousing a Space.", "Fuel."]) {
      expect(note.text, heading).toContain(heading);
      expect(note.html, heading).toContain(`<strong><em>${heading}</em></strong>`);
    }
    expect(note.text).toContain("5 Fire damage");
    expect(note.text).toContain("burns for 6 hours");
    expect(note.text).not.toContain("as detailed below");
    expect(note.html).toMatch(/^<p><strong><em>Dousing a Creature or an Object\.<\/em><\/strong> /);
  });

  it("never drops a headed use to make the budget, and prints the name alone when even their key clauses cannot fit", () => {
    const use = (name: string) => `<p class="indent"><b><i>${name}.</i></b> You can make a DC 15 check ${"word ".repeat(12).trim()}.</p>`;
    const some = itemNote(`${use("One")}${use("Two")}${use("Three")}`)!;
    for (const heading of ["One.", "Two.", "Three."]) expect(some.text).toContain(heading);
    const many = itemNote(["One", "Two", "Three", "Four", "Five", "Six", "Seven"].map(use).join(""));
    expect(many).toEqual({ html: "", text: "" });
  });

  it("reduces a 2014 tool to what it is for and its DC table, without the components and skill insight", () => {
    const note = itemNote(NAVIGATORS_2014)!;
    expect(note.text).toBe(
      "Proficiency with navigator's tools helps you determine a true course based on observing the stars. " +
        "Plot a course DC 10; Discover your position on a nautical chart DC 15.",
    );
  });

  it("prints a table whose only answer is 'Varies' as nothing", () => {
    const xml = `${NAVIGATORS_2014.replace(/<tr><td>Plot[\s\S]*<\/table>/, "<tr><td>Pick a lock</td><td>Varies</td></tr></table>")}`;
    expect(itemNote(xml)!.text).not.toContain("Varies");
  });

  it("stays inside the budget and keeps the source order", () => {
    const sentence = (n: number) => `Step ${n} requires a DC ${10 + n} Strength check and deals ${n} damage to the target.`;
    const xml = `<p>${Array.from({ length: 30 }, (_, n) => sentence(n)).join(" ")}</p>`;
    const note = itemNote(xml)!;
    expect(note.text.length).toBeLessThanOrEqual(NOTE_BUDGET);
    const steps = [...note.text.matchAll(/Step (\d+)/g)].map((m) => Number(m[1]));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it("prints the name alone when the one rule is too long to fit, rather than a clipped clause", () => {
    const words = "word ".repeat(120).trim();
    expect(itemNote(`<p>You can make a DC 15 check ${words}.</p>`)).toEqual({ html: "", text: "" });
  });

  it("falls back to the opening sentence when a description has no rules cue at all", () => {
    expect(itemNote("<p>A small carved bird. It is very pretty.</p>")!.text).toBe("A small carved bird.");
  });

  it("is null for an empty description and escapes markup characters in what it keeps", () => {
    expect(itemNote(undefined)).toBeNull();
    expect(itemNote("<p>  </p>")).toBeNull();
    const note = itemNote("<p>Roll a check &amp; add 1d4 &lt;damage&gt;.</p>")!;
    expect(note.text).toBe("Roll a check & add 1d4 <damage>.");
    expect(note.html).toBe("<p>Roll a check &amp; add 1d4 &lt;damage&gt;.</p>");
  });
});
