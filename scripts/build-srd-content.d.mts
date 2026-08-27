/** Types for the parts of the generator that tests import. */
export interface ScannedNode {
  kind: "element" | "append" | "info" | "comment" | "text";
  leading: string;
  source: string;
  path: string;
  id: string;
  name: string;
  type: string;
  sourceBook: string;
  supports: string[];
  grants: string[];
  requirements: string[];
  level: string | undefined;
}
export interface ScannedFile {
  prologue: string;
  nodes: ScannedNode[];
  epilogue: string;
}
export const NAMED_TYPES: Set<string>;
export interface Edition {
  key: string;
  title: string;
  srdDir: string;
  inventory: string;
  map: string;
  outputDir: string;
  sourceDirs: Array<{ dir: string; prefix: string }>;
  skipShippedIds: boolean;
  excludedFiles: Record<string, string>;
  authored: RegExp;
}
export const EDITIONS: { "5.1": Edition; "5.2": Edition };
export function scanFile(text: string, path: string): ScannedFile;
export function evaluateSupports(expression: string, have: ReadonlySet<string>): boolean;
export function trimDescription(element: ScannedNode): { source: string; trimmed: number };
