// Content element types as players read them. The XML keeps its own type names ("Race", "Sub Race",
// "Racial Trait", "Archetype"), which are part of the content format and never change; the app shows
// the words it uses everywhere else (Species, Subspecies, Subclass).
export const ELEMENT_TYPE_LABELS = {
  Race: 'Species',
  'Sub Race': 'Subspecies',
  'Race Variant': 'Species variant',
  'Racial Trait': 'Trait',
  Archetype: 'Subclass',
  'Archetype Feature': 'Subclass feature',
  Multiclass: 'Class',
  'Class Feature': 'Class feature',
};

export const elementTypeLabel = (type) => (type ? (ELEMENT_TYPE_LABELS[type] ?? type) : type);
