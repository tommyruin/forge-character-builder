/**
 * Progression view — derived from the elements tree, the derived level
 * history, the session level-registration records and the hit point rolls.
 */

import type { ElementLibrary } from "../content/library.js";
import type { CharacterState, LevelHistoryEntry } from "../character/state.js";
import { evaluateRequirements } from "../selection/expr.js";
import { createRegistrationContext } from "../selection/selection.js";
import { classElementForMulticlass, extractHitDie, mainClassIdOf, MAX_LEVEL, OPTION_AVERAGE_HP, OPTION_MULTICLASSING } from "./leveling.js";

export interface ProgressionClass {
  classId: string;
  className: string;
  level: number;
  isMulticlass: boolean;
  /** Display form of the class's hit die (e.g. "d8"). */
  hitDie: string;
  /** Pre-rolled hit point values for levels 1..level of this class. */
  hitPointValues: number[];
  /** Whether this class's most recent level can be removed right now. */
  canLower: boolean;
}

export interface ProgressionHistoryEntry extends Omit<LevelHistoryEntry, "classId" | "classLevel"> {
  classId: string | null;
  className: string;
  classLevel: number | null;
}

export interface Progression {
  canLevelUp: boolean;
  canLevelDown: boolean;
  hasMainClass: boolean;
  canMulticlass: boolean;
  hasMulticlass: boolean;
  multiclassRuleEnabled: boolean;
  classes: ProgressionClass[];
  usesAverageHitPoints: boolean;
  levelHistory: ProgressionHistoryEntry[];
  canUndoDelevel: boolean;
}

function classNameFor(library: ElementLibrary, classId: string): string {
  return (
    library.byId.get(classId)?.identity.name ??
    classElementForMulticlass(library, classId)?.identity.name ??
    ""
  );
}

export function buildProgression(state: CharacterState, library: ElementLibrary): Progression {
  const mainClassId = mainClassIdOf(state);
  const multiclassIds: string[] = [];
  for (const entry of state.levelHistory) {
    if (entry.isMulticlass && !entry.isPending && !multiclassIds.includes(entry.classId)) multiclassIds.push(entry.classId);
  }
  const rolls = state.hitPointRolls;

  const classes: ProgressionClass[] = [];
  if (mainClassId) {
    const classElement = library.byId.get(mainClassId);
    const level = state.levelHistory.filter((entry) => entry.classId === mainClassId && !entry.isMulticlass).length;
    classes.push({
      classId: mainClassId,
      className: classElement?.identity.name ?? "",
      level,
      isMulticlass: false,
      hitDie: classElement ? `d${extractHitDie(classElement)}` : "",
      hitPointValues: (rolls[mainClassId] ?? []).slice(0, level),
      canLower: false,
    });
  }
  multiclassIds.forEach((classId) => {
    const classElement = classElementForMulticlass(library, classId);
    const level = state.levelHistory.filter((entry) => entry.classId === classId && entry.isMulticlass).length;
    classes.push({
      classId,
      className: classElement?.identity.name ?? "",
      level,
      isMulticlass: true,
      hitDie: classElement ? `d${extractHitDie(classElement)}` : "",
      hitPointValues: (rolls[classId] ?? []).slice(0, level),
      canLower: false,
    });
  });

  const levelHistory: ProgressionHistoryEntry[] = state.levelHistory.map((entry) =>
    entry.isPending
      ? { ...entry, classId: null, className: "Unresolved multiclass", classLevel: null }
      : { ...entry, className: classNameFor(library, entry.classId) },
  );

  const multiclassRuleEnabled = state.options.has(OPTION_MULTICLASSING);
  const mainClass = mainClassId ? library.byId.get(mainClassId) : undefined;
  const prereqMet =
    mainClass?.multiclass?.requirements === undefined
      ? true
      : evaluateRequirements(mainClass.multiclass.requirements, createRegistrationContext(state, library, [], state.level));
  const latestHistory = state.levelHistory[state.levelHistory.length - 1];
  const latestRegistration = state.levelRegistrations[state.levelRegistrations.length - 1];
  const canLevelDown =
    mainClassId !== null &&
    state.level > 1 &&
    latestHistory !== undefined &&
    latestRegistration !== undefined &&
    latestHistory.totalLevel === latestRegistration.totalLevel &&
    latestHistory.classId === latestRegistration.classId &&
    latestHistory.classLevel === latestRegistration.classLevel &&
    latestHistory.isMulticlass === latestRegistration.isMulticlass &&
    latestHistory.isClassStart === latestRegistration.isClassStart;
  // Lowering a class unwinds every level above its most recent one and replays
  // them, so it needs a registration record for each of those levels. Imported
  // characters only carry records for the levels the engine could account for.
  const oldestRecordedLevel = state.levelRegistrations[0]?.totalLevel ?? Number.POSITIVE_INFINITY;
  for (const entry of classes) {
    const own = [...state.levelHistory]
      .reverse()
      .find((level) => level.classId === entry.classId && level.isMulticlass === entry.isMulticlass);
    entry.canLower =
      canLevelDown && own !== undefined && own.totalLevel > 1 && own.totalLevel >= oldestRecordedLevel;
  }

  return {
    canLevelUp: state.level < MAX_LEVEL,
    canLevelDown,
    hasMainClass: mainClassId !== null,
    canMulticlass: multiclassRuleEnabled && mainClassId !== null && state.level > 1 && prereqMet,
    hasMulticlass: multiclassIds.length > 0,
    multiclassRuleEnabled,
    classes,
    usesAverageHitPoints: state.options.has(OPTION_AVERAGE_HP),
    levelHistory,
    canUndoDelevel: state.delevelSnapshot !== null,
  };
}
