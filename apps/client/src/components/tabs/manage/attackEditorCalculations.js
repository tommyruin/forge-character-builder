const asNumber = (value) => Number(value) || 0;

const signed = (value) => (value >= 0 ? `+${value}` : String(value));

export function getDamageAbilityContext(draft, options, detail) {
  const caster = options?.casters?.find(
    (candidate) => candidate.identifier === draft.casterIdentifier,
  );
  const name =
    draft.calculationSource === 'caster'
      ? caster?.ability
      : draft.abilityName;
  const ability = detail?.abilities?.find(
    (candidate) =>
      candidate.name?.toLowerCase() === name?.toLowerCase(),
  );
  const modifier = asNumber(ability?.modifier);
  return {
    name: name || 'Ability',
    abbreviation: ability?.abbreviation ?? 'Ability',
    modifier,
    signedModifier: signed(modifier),
  };
}

function appendDamageBonus(dice, bonus, damageType) {
  let result = dice?.trim() ?? '';
  let inlineDamageType = '';
  const typeSeparator = result.indexOf(' ');
  if (typeSeparator > 0) {
    inlineDamageType = result.slice(typeSeparator + 1).trim();
    result = result.slice(0, typeSeparator).trim();
  }
  if (bonus !== 0) result += signed(bonus);
  if (damageType?.trim()) result += ` ${damageType.trim()}`;
  else if (inlineDamageType) result += ` ${inlineDamageType}`;
  return result.trim();
}

export function calculateAttackPreview(draft, options, detail) {
  const caster = options?.casters?.find(
    (candidate) => candidate.identifier === draft.casterIdentifier,
  );
  const ability = getDamageAbilityContext(draft, options, detail);
  const baseAttack =
    draft.calculationSource === 'caster'
      ? asNumber(caster?.attackModifier)
      : ability.modifier +
        (draft.useProficiency ? asNumber(detail?.proficiency) : 0);
  const attackBonus = baseAttack + asNumber(draft.attackMiscBonus);
  const damageBonus =
    asNumber(draft.damageMiscBonus) +
    (draft.addAbilityToDamage ? ability.modifier : 0);

  return {
    bonus: `${signed(attackBonus)} vs AC`,
    damage: appendDamageBonus(
      draft.damageDice,
      damageBonus,
      draft.damageType,
    ),
  };
}

export function calculateAttackComputation(draft, options, detail) {
  const miscellaneous = asNumber(draft.attackMiscBonus);
  if (draft.calculationSource === 'caster') {
    const caster = options?.casters?.find(
      (candidate) => candidate.identifier === draft.casterIdentifier,
    );
    const casterComputation = caster?.computation ?? {};
    const contributions = [
      ...(casterComputation.attackBonusContributions ??
        (caster
          ? [{ label: 'Spell attack', value: asNumber(caster.attackModifier) }]
          : [])),
    ];
    if (miscellaneous !== 0) {
      contributions.push({ label: 'Miscellaneous', value: miscellaneous });
    }
    return {
      ...casterComputation,
      attackBonusContributions: contributions,
    };
  }

  const ability = getDamageAbilityContext(draft, options, detail);
  const contributions = [{ label: ability.name, value: ability.modifier }];
  if (draft.useProficiency) {
    contributions.push({
      label: 'Proficiency',
      value: asNumber(detail?.proficiency),
    });
  }
  if (miscellaneous !== 0) {
    contributions.push({ label: 'Miscellaneous', value: miscellaneous });
  }
  return {
    attackBonusContributions: contributions,
    appliedModifiers: [],
    sourceNotes: [],
  };
}

function abilityModifier(detail, name) {
  const ability = detail?.abilities?.find(
    (candidate) =>
      candidate.name?.toLowerCase() === name?.toLowerCase(),
  );
  return ability ? asNumber(ability.modifier) : null;
}

function adjustWeaponAttackBonus(value, modifierDelta) {
  if (!value || modifierDelta === 0) return value ?? '';
  return value.replace(/[+-]?\d+/, (current) =>
    signed(asNumber(current) + modifierDelta),
  );
}

function adjustWeaponDamage(value, modifierDelta) {
  if (!value || modifierDelta === 0) return value ?? '';
  const match = value.match(/^(\s*\d+d\d+)([+-]\d+)?(.*)$/i);
  if (!match) return value;
  const adjustedBonus = asNumber(match[2]) + modifierDelta;
  return `${match[1]}${signed(adjustedBonus)}${match[3]}`;
}

export function calculateWeaponPreview(attack, draft, detail) {
  const currentAbility = attack?.ability;
  const selectedAbility =
    draft?.abilityMode === 'default'
      ? (attack?.defaultAbility ?? currentAbility)
      : draft?.abilityName;
  const currentModifier = abilityModifier(detail, currentAbility);
  const selectedModifier = abilityModifier(detail, selectedAbility);
  const generated = attack?.generated ?? {};

  if (currentModifier === null || selectedModifier === null) {
    return {
      bonus: generated.bonus ?? attack?.bonus ?? '',
      damage: generated.damage ?? attack?.damage ?? '',
    };
  }

  const modifierDelta = selectedModifier - currentModifier;
  return {
    bonus: adjustWeaponAttackBonus(
      generated.bonus ?? attack?.bonus,
      modifierDelta,
    ),
    damage: adjustWeaponDamage(
      generated.damage ?? attack?.damage,
      modifierDelta,
    ),
  };
}

/** The leading dice token of a damage string ("1d6" of "1d6+4 bludgeoning"). */
export function leadingDamageDie(value) {
  return (value ?? '').match(/^\s*\d+(?:d\d+)?/)?.[0]?.trim() ?? '';
}

/**
 * The live bonus and damage of an unarmed strike row while the editor is open.
 *
 * The saved row bakes in whichever die was chosen when it was written, so the
 * automatic die always comes from the engine's `options.unarmed` preview and
 * the draft's chosen die is substituted over the top. Without this the output
 * would not move when the die selection changes.
 */
export function calculateUnarmedPreview(attack, draft, detail, options) {
  const base = attack
    ? calculateWeaponPreview(attack, draft, detail)
    : { bonus: draft?.bonus ?? '', damage: draft?.damage ?? '' };
  const chosen = (draft?.unarmedDice ?? '').trim();
  const die = chosen === ''
    ? leadingDamageDie(options?.unarmed?.damage)
    : chosen;
  if (die === '') return base;
  const current = leadingDamageDie(base.damage);
  if (current === '') return base;
  return { bonus: base.bonus, damage: die + base.damage.trimStart().slice(current.length) };
}

export function buildAttackWriteRequest(draft) {
  const {
    overrideFields = [],
    ...request
  } = draft;
  // Adding an owned weapon: the engine builds every display field from the
  // inventory record, so the identifier is the whole request.
  if (draft.mode === 'weapon' && draft.identifier) {
    return { mode: 'weapon', identifier: draft.identifier };
  }
  const normalizedRequest = {
    ...request,
    attackMiscBonus: asNumber(draft.attackMiscBonus),
    damageMiscBonus: asNumber(draft.damageMiscBonus),
  };
  if (draft.mode === 'calculated') {
    return {
      ...normalizedRequest,
      bonus: overrideFields.includes('bonus') ? draft.bonus : null,
      damage: overrideFields.includes('damage') ? draft.damage : null,
    };
  }
  if (draft.mode === 'unarmed') {
    // The bonus and damage of an unarmed strike are always derived, so the
    // editor never sends them.
    const { bonus: _bonus, damage: _damage, unarmedDiceCustom: _unarmedDiceCustom, ...unarmedRequest } =
      normalizedRequest;
    return {
      ...unarmedRequest,
      // The stored die override travels on its own so the ability modifier
      // keeps recomputing; blank clears it.
      damageDice: draft.unarmedDice ?? '',
      name: overrideFields.includes('name') ? draft.name : null,
      range: overrideFields.includes('range') ? draft.range : null,
      description: overrideFields.includes('description')
        ? draft.description
        : null,
    };
  }
  if (
    draft.mode === 'weapon' ||
    draft.mode === 'spell'
  ) {
    return {
      ...normalizedRequest,
      name: overrideFields.includes('name') ? draft.name : null,
      range: overrideFields.includes('range') ? draft.range : null,
      bonus: overrideFields.includes('bonus') ? draft.bonus : null,
      damage: overrideFields.includes('damage') ? draft.damage : null,
      description: overrideFields.includes('description')
        ? draft.description
        : null,
    };
  }
  return normalizedRequest;
}
