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
}

export type Adapter = (data: unknown) => AdapterResult;

function asRecord(data: unknown, namespace: string): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${namespace}: expected a JSON object at the top level`);
  }
  return data as Record<string, unknown>;
}

/** base_items.json: metadata id → { name, item_class, release_state, ... } */
export const baseItems: Adapter = (data) => {
  const entries = asRecord(data, 'base_items');
  const terms: Term[] = [];
  let unreleased = 0;
  let emptyName = 0;
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
    terms.push({ id, text: v.name, category: typeof v.item_class === 'string' ? v.item_class : undefined });
  }
  const anomalies: string[] = [];
  if (unreleased > 0) anomalies.push(`base_items: skipped ${unreleased} unreleased entries`);
  if (emptyName > 0) anomalies.push(`base_items: skipped ${emptyName} entries with empty/missing name`);
  return { terms, anomalies };
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
    terms.push({ id, text, category: v.active_skill ? 'active' : 'support' });
  }
  const anomalies: string[] = [];
  if (skipped > 0) anomalies.push(`gems: skipped ${skipped} entries with no display name (mod-only effects)`);
  return { terms, anomalies };
};

/**
 * gem_tags.json: tag id → display string | null. Null means the tag has no
 * display text (e.g. `strength`) — skipped by design, not an anomaly.
 */
export const gemTags: Adapter = (data) => {
  const entries = asRecord(data, 'gem_tags');
  const terms: Term[] = [];
  let empty = 0;
  for (const [id, v] of Object.entries(entries)) {
    if (v === null) continue;
    if (typeof v !== 'string' || v === '') {
      empty++;
      continue;
    }
    terms.push({ id, text: v });
  }
  const anomalies: string[] = [];
  if (empty > 0) anomalies.push(`gem_tags: skipped ${empty} non-null entries with empty/non-string value`);
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
  gem_tags: gemTags,
  item_classes: itemClasses,
  essences,
  fossils,
  uniques,
};
