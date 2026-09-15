import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../tabs/EquipmentTab.jsx', import.meta.url),
  'utf8',
);
const icons = readFileSync(new URL('../Icon.jsx', import.meta.url), 'utf8');

// A slotless item — a cloak, a ring, goggles — fills no hand or armor slot.
// The engine offers it the single "worn" location, and the tab has to name
// that action in the player's terms rather than falling through to the
// generic "Equip"/"Unequip" pair the slot buttons use.
describe('equipment wear action', () => {
  it('labels the slotless equip action "Wear"', () => {
    expect(source).toMatch(/EQUIP_ACTION_LABELS\s*=\s*\{[^}]*worn:\s*"Wear"/s);
  });

  it('gives the wear action an icon the icon set defines', () => {
    const icon = /EQUIP_ACTION_ICONS\s*=\s*\{[^}]*worn:\s*"([^"]+)"/s.exec(source);
    expect(icon).not.toBeNull();
    expect(icons).toMatch(new RegExp(`\\b${icon[1]}:`));
  });

  it('calls taking a worn item off "Remove"', () => {
    expect(source).toMatch(/item\.equippedLocation === null \? "Remove" : "Unequip"/);
  });
});
