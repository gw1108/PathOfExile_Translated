// Per-namespace adapters: extract (term_id, display text, optional category)
// from one locale's raw file. Term identity rule: always the game's own
// internal id. Sole documented exception: `uniques`, keyed by its
// English-name `id` field (see Plan.md, "Scope decision").

export interface Term {
  id: string;
  text: string;
  category?: string;
}

export interface AdapterResult {
  terms: Term[];
  /** Human-readable per-file anomaly notes (summarized, not per-entry spam). */
  anomalies: string[];
  /**
   * Term ids skipped because their name is a dev placeholder. When English
   * reports an id here, ingest suppresses it in every locale — localized
   * files often carry a real-looking translation for these dev-only items.
   */
  placeholderIds?: string[];
}

export type Adapter = (data: unknown) => AdapterResult;

function asRecord(data: unknown, namespace: string): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${namespace}: expected a JSON object at the top level`);
  }
  return data as Record<string, unknown>;
}

/**
 * Dev placeholder names GGG ships marked "released" but never shows to
 * players: "[DNT] ...", "[DNT-UNUSED] ...", "[UNUSED] ...", "[DO NOT USE] ...".
 * These are noise in a terminology dictionary and are skipped everywhere a
 * display name is read.
 */
export function isPlaceholderName(name: string): boolean {
  return /^\[\s*(?:DNT|UNUSED|DO NOT USE)/i.test(name);
}

/**
 * Strips GGG keyword markup from a display string: `[Fire]` renders as
 * "Fire", `[AoESkill|AoE]` renders as "AoE" (left side is the keyword id,
 * right side the display text). poe2 gem_tags values use this markup; poe1
 * values are plain and pass through unchanged.
 */
export function stripMarkup(text: string): string {
  return text
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$2')
    .replace(/\[([^\]|]*)\]/g, '$1');
}

/**
 * Strips render markup from a display name: `<size:37>{ระเบิด}` renders as
 * "ระเบิด". Seen in poe2 Thai data; every other locale is plain and passes
 * through unchanged.
 */
export function stripRenderMarkup(text: string): string {
  return text.replace(/<size:\d+>\{([^}]*)\}/g, '$1');
}

/** base_items.json: metadata id → { name, item_class, release_state, ... } */
export const baseItems: Adapter = (data) => {
  const entries = asRecord(data, 'base_items');
  const terms: Term[] = [];
  let unreleased = 0;
  let emptyName = 0;
  const placeholderIds: string[] = [];
  for (const [id, raw] of Object.entries(entries)) {
    const v = raw as { name?: unknown; item_class?: unknown; release_state?: unknown };
    if (v.release_state === 'unreleased') {
      unreleased++;
      continue;
    }
    if (typeof v.name !== 'string' || v.name === '') {
      emptyName++;
      continue;
    }
    if (isPlaceholderName(v.name)) {
      placeholderIds.push(id);
      continue;
    }
    terms.push({ id, text: v.name, category: typeof v.item_class === 'string' ? v.item_class : undefined });
  }
  const anomalies: string[] = [];
  if (unreleased > 0) anomalies.push(`base_items: skipped ${unreleased} unreleased entries`);
  if (emptyName > 0) anomalies.push(`base_items: skipped ${emptyName} entries with empty/missing name`);
  if (placeholderIds.length > 0) anomalies.push(`base_items: skipped ${placeholderIds.length} dev-placeholder names ([DNT]/[UNUSED]/...)`);
  return { terms, anomalies, placeholderIds };
};

/**
 * gems.json: gem id → { active_skill?, base_item?, ... }. Localized name is
 * active_skill.display_name (active gems) or base_item.display_name
 * (supports). Entries with neither (mod-only effects) are skipped by design.
 */
export const gems: Adapter = (data) => {
  const entries = asRecord(data, 'gems');
  const terms: Term[] = [];
  let skipped = 0;
  const placeholderIds: string[] = [];
  for (const [id, raw] of Object.entries(entries)) {
    const v = raw as {
      active_skill?: { display_name?: unknown } | null;
      base_item?: { display_name?: unknown } | null;
    };
    const active = v.active_skill?.display_name;
    const support = v.base_item?.display_name;
    const text = typeof active === 'string' && active !== '' ? active
      : typeof support === 'string' && support !== '' ? support
      : undefined;
    if (text === undefined) {
      skipped++;
      continue;
    }
    if (isPlaceholderName(text)) {
      placeholderIds.push(id);
      continue;
    }
    terms.push({ id, text, category: v.active_skill ? 'active' : 'support' });
  }
  const anomalies: string[] = [];
  if (skipped > 0) anomalies.push(`gems: skipped ${skipped} entries with no display name (mod-only effects)`);
  if (placeholderIds.length > 0) anomalies.push(`gems: skipped ${placeholderIds.length} dev-placeholder names ([DNT]/[UNUSED]/...)`);
  return { terms, anomalies, placeholderIds };
};

/**
 * skill_gems.json (poe2): metadata path → { base_item?, gem_type, ... }.
 * The localized name is base_item.display_name for every gem type; gem_type
 * ("active" | "support" | "spirit") becomes the category.
 */
export const skillGems: Adapter = (data) => {
  const entries = asRecord(data, 'skill_gems');
  const terms: Term[] = [];
  let skipped = 0;
  let unreleased = 0;
  const placeholderIds: string[] = [];
  for (const [id, raw] of Object.entries(entries)) {
    const v = raw as {
      base_item?: { display_name?: unknown; release_state?: unknown } | null;
      gem_type?: unknown;
    };
    if (v.base_item?.release_state === 'unreleased') {
      unreleased++;
      continue;
    }
    const text = v.base_item?.display_name;
    if (typeof text !== 'string' || text === '') {
      skipped++;
      continue;
    }
    if (isPlaceholderName(text)) {
      placeholderIds.push(id);
      continue;
    }
    terms.push({ id, text, category: typeof v.gem_type === 'string' ? v.gem_type : undefined });
  }
  const anomalies: string[] = [];
  if (unreleased > 0) anomalies.push(`skill_gems: skipped ${unreleased} unreleased entries`);
  if (skipped > 0) anomalies.push(`skill_gems: skipped ${skipped} entries with no display name`);
  if (placeholderIds.length > 0) anomalies.push(`skill_gems: skipped ${placeholderIds.length} dev-placeholder names ([DNT]/[UNUSED]/...)`);
  return { terms, anomalies, placeholderIds };
};

/**
 * gem_tags.json: tag id → display string | null. Null means the tag has no
 * display text (e.g. `strength`) — skipped by design, not an anomaly.
 * poe2 values carry keyword markup ("[Fire]", "[AoESkill|AoE]") which is
 * reduced to its display text.
 */
export const gemTags: Adapter = (data) => {
  const entries = asRecord(data, 'gem_tags');
  const terms: Term[] = [];
  let empty = 0;
  let stripped = 0;
  for (const [id, v] of Object.entries(entries)) {
    if (v === null) continue;
    if (typeof v !== 'string' || v === '') {
      empty++;
      continue;
    }
    const text = stripMarkup(v);
    if (text !== v) stripped++;
    if (text === '') {
      empty++;
      continue;
    }
    terms.push({ id, text });
  }
  const anomalies: string[] = [];
  if (empty > 0) anomalies.push(`gem_tags: skipped ${empty} non-null entries with empty/non-string value`);
  if (stripped > 0) anomalies.push(`gem_tags: stripped keyword markup from ${stripped} values`);
  return { terms, anomalies };
};

/** item_classes.json: class id → { name, category_id, ... } */
export const itemClasses: Adapter = (data) => {
  const entries = asRecord(data, 'item_classes');
  const terms: Term[] = [];
  let empty = 0;
  for (const [id, raw] of Object.entries(entries)) {
    const v = raw as { name?: unknown; category_id?: unknown };
    if (typeof v.name !== 'string' || v.name === '') {
      empty++;
      continue;
    }
    terms.push({ id, text: v.name, category: typeof v.category_id === 'string' ? v.category_id : undefined });
  }
  const anomalies: string[] = [];
  if (empty > 0) anomalies.push(`item_classes: skipped ${empty} entries with empty/missing name`);
  return { terms, anomalies };
};

function namedMapAdapter(namespace: string): Adapter {
  return (data) => {
    const entries = asRecord(data, namespace);
    const terms: Term[] = [];
    let empty = 0;
    for (const [id, raw] of Object.entries(entries)) {
      const v = raw as { name?: unknown };
      if (typeof v.name !== 'string' || v.name === '') {
        empty++;
        continue;
      }
      terms.push({ id, text: v.name });
    }
    const anomalies: string[] = [];
    if (empty > 0) anomalies.push(`${namespace}: skipped ${empty} entries with empty/missing name`);
    return { terms, anomalies };
  };
}

/** essences.json: essence item metadata id → { name, ... } */
export const essences: Adapter = namedMapAdapter('essences');

/** fossils.json: fossil item metadata id → { name, ... } */
export const fossils: Adapter = namedMapAdapter('fossils');

/**
 * uniques.json: positional numeric index → { id, name, is_alternate_art, ... }.
 * The numeric index is fragile across exports and never used. Terms are keyed
 * by the `id` field (the English display name — stable across locales, where
 * `name` holds the translation). Entries sharing an `id` are deduplicated by
 * preferring the non-alternate-art entry.
 */
export const uniques: Adapter = (data) => {
  const entries = asRecord(data, 'uniques');
  const byId = new Map<string, { text: string; category?: string; isAlt: boolean }>();
  let empty = 0;
  let duplicates = 0;
  for (const raw of Object.values(entries)) {
    const v = raw as { id?: unknown; name?: unknown; is_alternate_art?: unknown; item_class?: unknown };
    if (typeof v.id !== 'string' || v.id === '' || typeof v.name !== 'string' || v.name === '') {
      empty++;
      continue;
    }
    const isAlt = v.is_alternate_art === true;
    const existing = byId.get(v.id);
    if (existing) {
      duplicates++;
      // Prefer the non-alternate-art entry.
      if (existing.isAlt && !isAlt) {
        byId.set(v.id, { text: v.name, category: typeof v.item_class === 'string' ? v.item_class : undefined, isAlt });
      }
      continue;
    }
    byId.set(v.id, { text: v.name, category: typeof v.item_class === 'string' ? v.item_class : undefined, isAlt });
  }
  const terms: Term[] = [...byId.entries()].map(([id, v]) => ({ id, text: v.text, category: v.category }));
  const anomalies: string[] = [];
  if (empty > 0) anomalies.push(`uniques: skipped ${empty} entries with empty/missing id or name`);
  if (duplicates > 0) anomalies.push(`uniques: deduplicated ${duplicates} shared-id entries (alternate art)`);
  return { terms, anomalies };
};

export const ADAPTERS: Record<string, Adapter> = {
  base_items: baseItems,
  gems,
  skill_gems: skillGems,
  gem_tags: gemTags,
  item_classes: itemClasses,
  essences,
  fossils,
  uniques,
};
