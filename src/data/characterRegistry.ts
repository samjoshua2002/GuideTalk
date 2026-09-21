/**
 * characterRegistry.ts
 *
 * Runtime character registry. Uses require() inside function bodies for ALL
 * cross-file data imports so there are ZERO module-level side effects and
 * ZERO circular initialization issues on Expo Web.
 *
 * Dependency graph (no cycles):
 *   types/character.ts  ← no deps
 *   characters.ts       ← types only  (static array)
 *   rivals.ts           ← types only  (CATEGORY_PRESETS, RIVAL_SUGGESTIONS)
 *   characterRegistry.ts← uses require() inside fns, so loads lazily
 */

import { Character } from '@/src/types/character';

// ─── Runtime custom character store ──────────────────────────────────────────

const runtimeCustomCharacters: Character[] = [];
let _allBuiltinCharacters: Character[] | null = null;

export function registerCustomCharacter(c: Character): void {
  _allBuiltinCharacters = null; // bust cache
  const existingIdx = runtimeCustomCharacters.findIndex((x) => x.id === c.id);
  if (existingIdx >= 0) {
    runtimeCustomCharacters[existingIdx] = c;
  } else {
    runtimeCustomCharacters.unshift(c);
  }
}

export function getRuntimeCustomCharacters(): Character[] {
  return runtimeCustomCharacters;
}

// ─── Lazy builtin character list ──────────────────────────────────────────────
// Both require() calls are INSIDE the function body so neither characters.ts
// nor rivals.ts is loaded at module initialization time — no cycle, no crash.

export function getAllBuiltinCharacters(): Character[] {
  if (!_allBuiltinCharacters) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const staticChars: Character[] = (require('./characters') as { characters: Character[] }).characters;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAllPresets } = require('./rivals') as { getAllPresets: () => Character[] };
    const presets = getAllPresets().filter((p) => !staticChars.some((c) => c.id === p.id));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WAIFUS_AND_HUSBANDS } = require('./waifusAndHusbands') as { WAIFUS_AND_HUSBANDS: Character[] };
    const waifusList = WAIFUS_AND_HUSBANDS.filter(
      (w) => !staticChars.some((c) => c.id === w.id) && !presets.some((p) => p.id === w.id)
    );
    _allBuiltinCharacters = staticChars.concat(presets, waifusList);
  }
  return _allBuiltinCharacters;
}

// ─── Character lookup ─────────────────────────────────────────────────────────

export function getCharacter(id: string, customList: Character[] = []): Character | undefined {
  const pool = ([] as Character[]).concat(customList, runtimeCustomCharacters, getAllBuiltinCharacters());
  return pool.find((c: any) => c.id === id || c.mongoId === id || c._id === id);
}
