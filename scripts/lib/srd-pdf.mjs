/**
 * Shared PDF layout helpers for the System Reference Document extractors:
 * column-aware line grouping, heading detection with small-caps joining,
 * heading-plus-subtitle entry extraction and cost-bearing table rows.
 */
export function createPdfHelpers(doc, { columnSplit = 300, warnings = [] } = {}) {
// ------------------------------------------------------------------ pages

  const pageCache = new Map();

/** Text items of one page grouped into lines per column, in reading order. */
  async function pageLines(pageNumber) {
  if (pageCache.has(pageNumber)) return pageCache.get(pageNumber);
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  const columns = [new Map(), new Map()];
  const whole = new Map();
  const place = (map, y, item) => {
    let key = y;
    for (const existing of map.keys()) {
      if (Math.abs(existing - y) <= 2) {
        key = existing;
        break;
      }
    }
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  };
  for (const raw of content.items) {
    if (!raw.str || !raw.str.trim()) continue;
    const item = {
      x: Math.round(raw.transform[4]),
      y: Math.round(raw.transform[5]),
      size: Math.round(Math.abs(raw.transform[3]) * 10) / 10,
      text: raw.str,
    };
    place(columns[item.x < columnSplit ? 0 : 1], item.y, item);
    place(whole, item.y, item);
  }
  const toLines = (map, column) =>
    [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, items]) => ({ page: pageNumber, column, y, items: items.sort((a, b) => a.x - b.x) }));
  const lines = { columns: [...toLines(columns[0], 0), ...toLines(columns[1], 1)], whole: toLines(whole, -1) };
  pageCache.set(pageNumber, lines);
  return lines;
}

  const lineText = (line) => line.items.map((item) => item.text).join("").replace(/\s+/g, " ").trim();

/**
 * Reads a heading line set at `size` pt. Small-caps continuation glyphs are
 * set at roughly 70% of the heading size ("Acid Spl" + "AS" + "h"); they are
 * lowercased and joined. Returns null when the line is not a heading.
 */
  function headingText(line, size) {
  const big = line.items.filter((item) => Math.abs(item.size - size) <= 0.6);
  if (big.length === 0) return null;
  const small = line.items.filter((item) => item.size < size - 0.6);
  if (small.some((item) => item.size < size * 0.6 || item.size > size * 0.78)) return null;
  const text = line.items
    .map((item) => (Math.abs(item.size - size) <= 0.6 ? item.text : item.text.toLowerCase()))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** Column-ordered lines across an inclusive page range. Chapters share
 * pages at their boundaries, so ranges are inclusive and the subtitle
 * discriminator keeps a neighbouring chapter's entries out. */
  async function linesInRange(from, to) {
  const out = [];
  for (let page = from; page <= to; page += 1) out.push(...(await pageLines(page)).columns);
  return out;
}

/** Headings that are part of a stat block or section scaffold, never entries. */
  const STRUCTURAL = /^(Actions|Bonus Actions|Reactions|Traits|Legendary Actions|Targets|Saving Throws|Attack Rolls|Combining Spell Effects)$/;


/**
 * Entries of a heading-plus-subtitle chapter. `subtitle` must match the line
 * following the heading in the same column; headings matching `skip` are
 * structural (class features, section titles) rather than entries.
 */
  async function headingEntries({ chapter, from, to, size = 12, subtitle, skip = /^$/, minWords = 1 }) {
  const lines = await linesInRange(from, to);
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = headingText(line, size);
    if (!heading || skip.test(heading) || STRUCTURAL.test(heading)) continue;
    const next = lines[index + 1];
    const sameColumn = next && next.page === line.page && next.column === line.column;
    const sub = sameColumn ? lineText(next) : "";
    const matches = subtitle.test(sub);
    if (matches) {
      entries.push({ name: heading, page: line.page, subtitle: sub });
    } else if (heading.split(" ").length >= minWords && /^[A-Z]/.test(heading)) {
      warnings.push({ chapter, page: line.page, issue: "heading without a matching subtitle", text: heading, next: sub });
    }
  }
  return entries;
}

/**
 * Equipment table rows: a row carries a coin cost; the name is the run of
 * cells immediately before the table-ish cells (damage, properties, mastery,
 * weight, armour class) that precede the cost. Scanning backwards from the
 * cost keeps body text from the other page column out of the name.
 */
  async function tableRows({ from, to, stopHeading, costPattern }) {
  const rows = [];
  const cost = costPattern ?? /^\s*\d[\d,]*\s*(CP|SP|GP|PP)\s*$/;
  const tableish =
    /^\s*(\d|—|−|\+\d|Str \d|Disadvantage|None\b|(?:Light|Heavy|Finesse|Thrown|Versatile|Two-Handed|Reach|Ammunition|Loading|Range)(?:,|\s*\(|$)|Cleave\b|Graze\b|Nick\b|Push\b|Sap\b|Slow\b|Topple\b|Vex\b|Cloak\b|Speed \d|(?:Contact|Ingested|Inhaled|Injury)$|\d+d\d+)/;
  for (let page = from; page <= to; page += 1) {
    const { whole, columns } = await pageLines(page);
    let stopY = -Infinity;
    if (page === to && stopHeading) {
      const heading = columns.find((line) => lineText(line) === stopHeading);
      if (heading) stopY = heading.y;
    }
    for (const pageLine of whole) {
      if (pageLine.y <= stopY) continue;
      // Two tables can sit side by side (the SRD 5.1 gear table); a line with
      // a cost cell in each page column is two rows.
      const costCells = pageLine.items.filter((item) => cost.test(item.text));
      const twoTables = costCells.length >= 2 && costCells.some((item) => item.x < columnSplit) && costCells.some((item) => item.x >= columnSplit);
      const segments = twoTables
        ? [pageLine.items.filter((item) => item.x < columnSplit), pageLine.items.filter((item) => item.x >= columnSplit)]
        : [pageLine.items];
      for (const items of segments) {
      const line = { ...pageLine, items };
      const costIndex = line.items.findIndex((item) => cost.test(item.text));
      if (costIndex <= 0) continue;
      const cells = line.items.slice(0, costIndex);
      let end = cells.length;
      // Ammunition rows carry a container cell ("Arrows | 20 | Quiver | 1 lb.");
      // it counts as a table cell only when something precedes it, so the
      // Pouch and Quiver rows themselves keep their names.
      const container = /^(Pouch|Case|Quiver)$/;
      while (
        end > 0 &&
        (tableish.test(cells[end - 1].text) || /\blb\.?/.test(cells[end - 1].text) || (end > 1 && container.test(cells[end - 1].text.trim())))
      ) end -= 1;
      if (end === 0) continue;
      let start = end - 1;
      while (start > 0 && cells[start].x - cells[start - 1].x < 60 && !/[.!?]$/.test(cells[start - 1].text.trim())) start -= 1;
      const name = cells
        .slice(start, end)
        .map((cell) => cell.text)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (!name || /^(Name|Item|Weapon|Armor|Cost)$/i.test(name) || /[.!?]$/.test(name) || name.length > 60) continue;
      rows.push({ name, page, cost: line.items[costIndex].text.trim() });
      }
    }
  }
  return rows;
}


  return { pageLines, lineText, headingText, linesInRange, headingEntries, tableRows, warnings };
}
