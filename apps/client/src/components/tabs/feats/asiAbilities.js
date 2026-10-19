// The six "Ability Score Improvement" elements (+1 each). They ship in the core baseline, so a
// +2-to-one ASI is the same id twice. Granting these is what a level-up ASI registers, so the
// increase shows up identically in the Ability Scores breakdown and on the sheet.
export const ASI_ABILITIES = [
  { key: 'Strength', id: 'ID_INTERNAL_ASI_STRENGTH' },
  { key: 'Dexterity', id: 'ID_INTERNAL_ASI_DEXTERITY' },
  { key: 'Constitution', id: 'ID_INTERNAL_ASI_CONSTITUTION' },
  { key: 'Intelligence', id: 'ID_INTERNAL_ASI_INTELLIGENCE' },
  { key: 'Wisdom', id: 'ID_INTERNAL_ASI_WISDOM' },
  { key: 'Charisma', id: 'ID_INTERNAL_ASI_CHARISMA' },
];
