export const GLOBAL_SECTIONS = [
  ['characters', 'Characters', 'Characters'],
  ['content', 'Content', 'Content'],
  ['homebrew', 'Homebrew', 'Homebrew'],
];

const SECTION_KEYS = new Set(GLOBAL_SECTIONS.map(([key]) => key));

export function getGlobalNavigationTabs(openCharacterId) {
  return [
    ...(openCharacterId
      ? [
          {
            key: 'workspace',
            section: 'characters',
            characterSurface: 'workspace',
            label: openCharacterId,
            compactLabel: openCharacterId,
          },
        ]
      : []),
    {
      key: 'collection',
      section: 'characters',
      characterSurface: 'collection',
      label: 'Characters',
      compactLabel: 'Characters',
    },
    ...GLOBAL_SECTIONS.filter(([key]) => key !== 'characters').map(
      ([key, label, compactLabel]) => ({
        key,
        section: key,
        characterSurface: null,
        label,
        compactLabel,
      }),
    ),
  ];
}

export function createNavigationState() {
  let savedCharacterId = null;
  try {
    savedCharacterId = globalThis.localStorage?.getItem('tcb-active-character') || null;
  } catch {
    // Storage can be unavailable in privacy mode and in non-browser tests.
  }
  return {
    activeSection: 'characters',
    characterSurface: savedCharacterId ? 'workspace' : 'collection',
    openCharacterId: savedCharacterId,
    cloudOpen: false,
    visitedSections: {
      content: false,
      homebrew: false,
    },
  };
}

export function navigationReducer(state, action) {
  switch (action.type) {
    case 'select-section': {
      if (!SECTION_KEYS.has(action.section)) return state;
      return {
        ...state,
        activeSection: action.section,
        visitedSections:
          action.section === 'characters'
            ? state.visitedSections
            : {
                ...state.visitedSections,
                [action.section]: true,
              },
      };
    }
    case 'open-character':
      return {
        ...state,
        activeSection: 'characters',
        characterSurface: 'workspace',
        openCharacterId: action.id,
      };
    case 'show-collection':
      try {
        globalThis.localStorage?.removeItem('tcb-active-character');
      } catch {
        // Best effort only; navigation state remains authoritative for this tab.
      }
      return {
        ...state,
        activeSection: 'characters',
        characterSurface: 'collection',
      };
    case 'show-workspace':
      if (!state.openCharacterId) return state;
      return {
        ...state,
        activeSection: 'characters',
        characterSurface: 'workspace',
      };
    case 'character-deleted':
      if (state.openCharacterId !== action.id) return state;
      return {
        ...state,
        activeSection: 'characters',
        characterSurface: 'collection',
        openCharacterId: null,
      };
    case 'open-cloud':
      return { ...state, cloudOpen: true };
    case 'close-cloud':
      return { ...state, cloudOpen: false };
    default:
      return state;
  }
}
