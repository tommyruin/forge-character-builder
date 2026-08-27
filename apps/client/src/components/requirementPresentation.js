const ELEMENT_ID_PATTERN = /\bID_[A-Za-z0-9_]+\b/g;
const BRACKET_REQUIREMENT_PATTERN = /\[([^\]]+)]/g;
const NEGATED_MULTICLASS_PATTERN =
  /!\s*(ID_[A-Za-z0-9_]*_MULTICLASS_[A-Za-z0-9_]+)\b/g;
const NEGATED_ELEMENT_PATTERN = /!\s*(ID_[A-Za-z0-9_]+)\b/gi;
const INTERNAL_CLASS_MULTICLASS_REQUIREMENT_PATTERN =
  /^!\s*ID_[A-Za-z0-9_]*_MULTICLASS_[A-Za-z0-9_]+\s*$/i;

const CATEGORY_MARKERS = [
  ['FEATURE', 'REPLACEMENT'],
  ['CLASS', 'FEATURE'],
  ['BACKGROUND', 'FEATURE'],
  ['RACIAL', 'TRAIT'],
  ['RACE', 'VARIANT'],
  ['SUB', 'RACE'],
  ['ABILITY', 'SCORE', 'IMPROVEMENT'],
  ['ARCHETYPE'],
  ['BACKGROUND'],
  ['COMPANION'],
  ['LANGUAGE'],
  ['MULTICLASS'],
  ['OPTION'],
  ['SPELL'],
  ['VISION'],
  ['FEAT'],
  ['ITEM'],
  ['LEVEL'],
  ['RACE'],
];

const KNOWN_WORDS = new Map([
  ['DARKVISION', 'Darkvision'],
  ['SUPERIORDARKVISION', 'Superior Darkvision'],
  ['ASI', 'ASI'],
  ['AC', 'AC'],
  ['HP', 'HP'],
  ['XP', 'XP'],
  ['STR', 'Strength'],
  ['DEX', 'Dexterity'],
  ['CON', 'Constitution'],
  ['INT', 'Intelligence'],
  ['WIS', 'Wisdom'],
  ['CHA', 'Charisma'],
]);

function titleCaseWord(word) {
  const known = KNOWN_WORDS.get(word.toUpperCase());
  if (known) return known;
  if (/^\d+$/.test(word)) return word;
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

function readableWords(value) {
  return String(value)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ');
}

function markerEnd(parts) {
  for (const marker of CATEGORY_MARKERS) {
    for (let index = 0; index <= parts.length - marker.length; index += 1) {
      if (marker.every((part, offset) => parts[index + offset] === part)) {
        return { marker, end: index + marker.length };
      }
    }
  }
  return null;
}

function trimRepeatedHierarchy(parts) {
  let repeatedStart = -1;
  for (let index = 0; index < parts.length; index += 1) {
    const laterIndex = parts.lastIndexOf(parts[index]);
    if (laterIndex > index) repeatedStart = Math.max(repeatedStart, laterIndex);
  }
  return repeatedStart >= 0 ? parts.slice(repeatedStart) : parts;
}

export function humanizeElementIdentifier(identifier) {
  const parts = String(identifier)
    .replace(/^ID_/i, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.toUpperCase());
  if (parts.length === 0) return '';

  const match = markerEnd(parts);
  if (!match) return readableWords(parts.join('_'));

  const suffix = parts.slice(match.end);
  if (match.marker.length === 1 && match.marker[0] === 'LEVEL') {
    return `Level ${readableWords(suffix.join('_'))}`.trim();
  }
  const displayParts =
    match.marker[0] === 'CLASS' && match.marker[1] === 'FEATURE'
      ? trimRepeatedHierarchy(suffix)
      : suffix;
  return readableWords(
    (displayParts.length > 0 ? displayParts : match.marker).join('_')
  );
}

function formatBracketRequirement(contents) {
  const separatorIndex = contents.search(/[:=]/);
  if (separatorIndex < 0) return readableWords(contents);

  const key = readableWords(contents.slice(0, separatorIndex));
  const value = readableWords(contents.slice(separatorIndex + 1));
  if (key.toLowerCase() === 'level') return `Level ${value}`.trim();
  return value ? `${key}: ${value}` : key;
}

function multiclassName(identifier) {
  const parts = String(identifier)
    .replace(/^ID_/i, '')
    .split('_')
    .filter(Boolean);
  const markerIndex = parts.findIndex(
    (part) => part.toUpperCase() === 'MULTICLASS'
  );
  return readableWords(parts.slice(markerIndex + 1).join('_'));
}

export function formatRequirementExpression(value) {
  if (!value) return '';

  const formatted = String(value)
    .replaceAll('&amp;', '&')
    .replace(BRACKET_REQUIREMENT_PATTERN, (_, contents) =>
      formatBracketRequirement(contents)
    )
    .replace(
      NEGATED_MULTICLASS_PATTERN,
      (_, identifier) => `not multiclassed as ${multiclassName(identifier)}`
    )
    .replace(ELEMENT_ID_PATTERN, (identifier) =>
      humanizeElementIdentifier(identifier)
    )
    .replace(/\s*(?:&&|&|,)\s*/g, ' and ')
    .replace(/\s*(?:\|\||\|)\s*/g, ' or ')
    .replace(/!\s*/g, 'not ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();

  return formatted.replace(/^not\b/, 'Not');
}

export function isInternalClassGrantRequirement({
  elementType,
  requirements,
}) {
  return (
    String(elementType).toLowerCase() === 'class' &&
    INTERNAL_CLASS_MULTICLASS_REQUIREMENT_PATTERN.test(String(requirements))
  );
}

function normalizeLabel(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function classNameFromIdentifier(identifier) {
  const parts = String(identifier)
    .replace(/^ID_/i, '')
    .split('_')
    .filter(Boolean);
  const classIndex = parts.findIndex(
    (part) => part.toUpperCase() === 'CLASS'
  );
  if (
    classIndex < 0 ||
    parts[classIndex + 1]?.toUpperCase() === 'FEATURE'
  ) {
    return '';
  }
  return readableWords(parts.slice(classIndex + 1).join('_'));
}

function cleanRemovedConjunctions(value) {
  return String(value)
    .replace(/\(\s*\)/g, '')
    .replace(/^(?:\s*(?:&&|&|,)\s*)+/, '')
    .replace(/(?:\s*(?:&&|&|,)\s*)+$/, '')
    .replace(/(?:\s*(?:&&|&|,)\s*){2,}/g, '&&')
    .trim();
}

export function requirementExpressionForPresentation({
  elementName,
  elementType,
  requirements,
}) {
  const expression = String(requirements ?? '');
  if (String(elementType).toLowerCase() !== 'multiclass') return expression;

  const normalizedElementName = normalizeLabel(elementName);
  const withoutSelfExclusion = expression.replace(
    NEGATED_ELEMENT_PATTERN,
    (match, identifier) =>
      normalizeLabel(classNameFromIdentifier(identifier)) ===
      normalizedElementName
        ? ''
        : match
  );
  return cleanRemovedConjunctions(withoutSelfExclusion);
}

function normalizeRequirementMeaning(value) {
  return String(value)
    .toLowerCase()
    .replace(/^\s*prerequisite\s*:\s*/, '')
    .replace(/\b(\d+)(?:st|nd|rd|th)\s+level\b/g, 'level $1')
    .replace(/\blevel\s*[:=]?\s*(\d+)\b/g, 'level $1')
    .replace(/\bstr\b/g, 'strength')
    .replace(/\bdex\b/g, 'dexterity')
    .replace(/\bcon\b/g, 'constitution')
    .replace(/\bint\b/g, 'intelligence')
    .replace(/\bwis\b/g, 'wisdom')
    .replace(/\bcha\b/g, 'charisma')
    .replace(/\bor\s+higher\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:and|or|feature|cantrip|spell)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function requirementDuplicatesPrerequisite({
  prerequisite,
  requirements,
}) {
  if (!prerequisite || !requirements) return false;
  return (
    normalizeRequirementMeaning(prerequisite) ===
    normalizeRequirementMeaning(formatRequirementExpression(requirements))
  );
}
