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
 * Strips render markup from a display string: `<size:37>{ระเบิด}` renders as
 * "ระเบิด" (seen in poe2 Thai names), and other `<tag>{...}` wrappers the
 * same way. Unwraps innermost-first so nested markup resolves fully. Plain
 * text — including literal `{0}` placeholders — passes through unchanged.
 */
export function stripRenderMarkup(text: string): string {
  const pattern = /<[a-z]+(?::\d+)?>\{([^{}]*)\}/gi;
  let previous: string;
  do {
    previous = text;
    text = text.replace(pattern, '$1');
  } while (text !== previous);
  // A handful of game strings have MALFORMED markup — the closing brace is a
  // fullwidth ｝, a ), or missing entirely. When a dangling opener remains,
  // drop it (and the stray closing character, if any).
  if (/<[a-z]+(?::\d+)?>\{/i.test(text)) {
    text = text.replace(/<[a-z]+(?::\d+)?>\{/gi, '').replace(/[)｝]\s*$/, '');
  }
  return text;
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

/**
 * stat_translations files: a top-level ARRAY of translation entries. Each
 * entry maps a stat-id tuple (`ids`) to a list of display variants under a
 * key named after the file's language ("English", "French", ...). Every
 * variant becomes its own term, keyed `<ids joined by space>[<variant index>]`
 * — variant order comes from the game's translation rows, so indexes align
 * across locales. Values are the display templates with numeric placeholders
 * normalized to `#` ("Allocates # Sinister Jewel sockets") and keyword/render
 * markup reduced to display text. Entries flagged `hidden` (RePoE-injected
 * custom translations, not game text) are skipped.
 */
export const statTranslations: Adapter = (data) => {
  if (!Array.isArray(data)) {
    throw new Error('stat_translations: expected a JSON array at the top level');
  }
  const META_KEYS = new Set(['ids', 'trade_stats', 'hidden']);
  const terms: Term[] = [];
  let hidden = 0;
  let empty = 0;
  let malformed = 0;
  for (const raw of data) {
    const entry = raw as Record<string, unknown>;
    if (entry.hidden === true) {
      hidden++;
      continue;
    }
    const ids = entry.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id !== '')) {
      malformed++;
      continue;
    }
    const langKey = Object.keys(entry).find((k) => !META_KEYS.has(k));
    const variants = langKey ? entry[langKey] : undefined;
    if (!Array.isArray(variants)) {
      malformed++;
      continue;
    }
    const base = ids.join(' ');
    variants.forEach((variant, i) => {
      const s = (variant as { string?: unknown } | null)?.string;
      if (typeof s !== 'string' || s === '') {
        empty++;
        return;
      }
      const text = stripMarkup(stripRenderMarkup(s.replace(/\{\d*(?::[^{}]*)?\}/g, '#'))).trim();
      if (text === '' || text === '#') {
        empty++;
        return;
      }
      terms.push({ id: `${base}[${i}]`, text });
    });
  }
  const anomalies: string[] = [];
  if (hidden > 0) anomalies.push(`stat_translations: skipped ${hidden} hidden entries (custom, not game text)`);
  if (empty > 0) anomalies.push(`stat_translations: skipped ${empty} empty/placeholder-only variants`);
  if (malformed > 0) anomalies.push(`stat_translations: skipped ${malformed} entries with missing ids/variants`);
  return { terms, anomalies };
};

/**
 * passive_skill_trees/<tree>.json: the `passives` map holds every node on
 * the tree, keyed by graph hash. Terms are keyed by the node's dat id (the
 * hash is layout-specific); icon-only decorations and unnamed nodes are
 * skipped. One namespace spans several tree files; nodes shared between
 * trees merge on id.
 */
export const passiveNodes: Adapter = (data) => {
  const tree = asRecord(data, 'passives');
  const nodes = tree.passives;
  if (typeof nodes !== 'object' || nodes === null || Array.isArray(nodes)) {
    throw new Error("passives: expected a 'passives' object in the tree file");
  }
  const terms: Term[] = [];
  let unnamed = 0;
  let iconOnly = 0;
  const placeholderIds: string[] = [];
  for (const raw of Object.values(nodes)) {
    const v = raw as {
      id?: unknown;
      name?: unknown;
      is_icon_only?: unknown;
      is_keystone?: unknown;
      is_notable?: unknown;
      is_jewel_socket?: unknown;
      ascendancy?: unknown;
    };
    if (v.is_icon_only === true) {
      iconOnly++;
      continue;
    }
    if (typeof v.id !== 'string' || v.id === '' || typeof v.name !== 'string' || v.name === '') {
      unnamed++;
      continue;
    }
    if (isPlaceholderName(v.name)) {
      placeholderIds.push(v.id);
      continue;
    }
    const category = v.is_keystone === true ? 'keystone'
      : v.is_notable === true ? 'notable'
      : v.is_jewel_socket === true ? 'jewel_socket'
      : typeof v.ascendancy === 'string' ? 'ascendancy'
      : 'basic';
    terms.push({ id: v.id, text: v.name, category });
  }
  const anomalies: string[] = [];
  if (unnamed > 0) anomalies.push(`passives: skipped ${unnamed} unnamed nodes`);
  if (placeholderIds.length > 0) anomalies.push(`passives: skipped ${placeholderIds.length} dev-placeholder names ([DNT]/[UNUSED]/...)`);
  return { terms, anomalies, placeholderIds };
};

/**
 * Factory for object-map files where each entry contributes one optional
 * display string: `getText` picks it, empty/missing entries are skipped and
 * summarized, placeholder names are skipped and reported for cross-locale
 * suppression.
 */
function entryTextAdapter(
  namespace: string,
  getText: (entry: Record<string, unknown>) => unknown,
  opts: {
    getCategory?: (entry: Record<string, unknown>) => string | undefined;
    /** Skip the entry when this returns a placeholder/dev name (defaults to the text itself). */
    getGuardName?: (entry: Record<string, unknown>) => unknown;
    transform?: (text: string) => string;
  } = {},
): Adapter {
  return (data) => {
    const entries = asRecord(data, namespace);
    const terms: Term[] = [];
    let empty = 0;
    const placeholderIds: string[] = [];
    for (const [id, raw] of Object.entries(entries)) {
      const entry = raw as Record<string, unknown>;
      const value = getText(entry);
      if (typeof value !== 'string' || value === '') {
        empty++;
        continue;
      }
      const guard = opts.getGuardName ? opts.getGuardName(entry) : value;
      if (typeof guard === 'string' && isPlaceholderName(guard)) {
        placeholderIds.push(id);
        continue;
      }
      const text = opts.transform ? opts.transform(value) : value;
      if (text === '') {
        empty++;
        continue;
      }
      terms.push({ id, text, category: opts.getCategory?.(entry) });
    }
    const anomalies: string[] = [];
    if (empty > 0) anomalies.push(`${namespace}: skipped ${empty} entries with empty/missing text`);
    if (placeholderIds.length > 0) {
      anomalies.push(`${namespace}: skipped ${placeholderIds.length} dev-placeholder names ([DNT]/[UNUSED]/...)`);
    }
    return { terms, anomalies, placeholderIds };
  };
}

/** Adapter for array files of { <idField>, <textField> } records. */
function arrayTextAdapter(namespace: string, idField: string, textField: string): Adapter {
  return (data) => {
    if (!Array.isArray(data)) throw new Error(`${namespace}: expected a JSON array at the top level`);
    const terms: Term[] = [];
    let empty = 0;
    const placeholderIds: string[] = [];
    for (const raw of data) {
      const entry = raw as Record<string, unknown>;
      const id = entry[idField];
      const text = entry[textField];
      if (typeof id !== 'string' || id === '' || typeof text !== 'string' || text === '') {
        empty++;
        continue;
      }
      if (isPlaceholderName(text)) {
        placeholderIds.push(id);
        continue;
      }
      terms.push({ id, text });
    }
    const anomalies: string[] = [];
    if (empty > 0) anomalies.push(`${namespace}: skipped ${empty} entries with empty/missing id or text`);
    if (placeholderIds.length > 0) {
      anomalies.push(`${namespace}: skipped ${placeholderIds.length} dev-placeholder names ([DNT]/[UNUSED]/...)`);
    }
    return { terms, anomalies, placeholderIds };
  };
}

const asString = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** mods.json: mod id → { name, generation_type, ... }. Most mods are unnamed (skipped). */
export const mods = entryTextAdapter('mods', (e) => e.name, {
  getCategory: (e) => asString(e.generation_type),
});

/** world_areas.json: area id → { name, is_town, ... }. */
export const worldAreas = entryTextAdapter('world_areas', (e) => e.name, {
  getCategory: (e) => (e.is_town === true ? 'town' : undefined),
});

/** buffs.json: buff id → { name, description, category, ... } — names. */
export const buffs = entryTextAdapter('buffs', (e) => e.name, {
  getCategory: (e) => asString(e.category),
});

/** buffs.json — descriptions ("You are Chilled."), suppressed when the name is a placeholder. */
export const buffDescriptions = entryTextAdapter('buff_descriptions', (e) => e.description, {
  getGuardName: (e) => e.name,
});

/** flavour.json: flavour id → lore text (unique items etc.), a plain string map. */
export const flavour: Adapter = (data) => {
  const entries = asRecord(data, 'flavour');
  const terms: Term[] = [];
  let empty = 0;
  const placeholderIds: string[] = [];
  for (const [id, v] of Object.entries(entries)) {
    if (typeof v !== 'string' || v === '') {
      empty++;
      continue;
    }
    if (isPlaceholderName(v)) {
      placeholderIds.push(id);
      continue;
    }
    terms.push({ id, text: v });
  }
  const anomalies: string[] = [];
  if (empty > 0) anomalies.push(`flavour: skipped ${empty} entries with empty/non-string value`);
  if (placeholderIds.length > 0) {
    anomalies.push(`flavour: skipped ${placeholderIds.length} dev-placeholder texts ([DNT]/[UNUSED]/...)`);
  }
  return { terms, anomalies, placeholderIds };
};

/** characters.json: an ARRAY of classes keyed by metadata_id ("Marauder", ...). */
export const characters = arrayTextAdapter('characters', 'metadata_id', 'name');

/** cluster_jewel_notables.json (poe1): an ARRAY of { id, name } notables not on the main tree. */
export const clusterJewelNotables = arrayTextAdapter('cluster_jewel_notables', 'id', 'name');

/** cost_types.json: cost id → { format_text } ("{0} Mana" → "# Mana"). */
export const costTypes = entryTextAdapter('cost_types', (e) => e.format_text, {
  transform: (t) => t.replace(/\{\d*(?::[^{}]*)?\}/g, '#'),
});

/** base_items.json — the usage text on currency/consumables ("Reforges a rare item..."). */
export const baseItemDescriptions = entryTextAdapter(
  'base_item_descriptions',
  (e) => (e.properties as { description?: unknown } | undefined)?.description,
  { getGuardName: (e) => e.name },
);

/** base_items.json — the "Right click this item then..." directions line. */
export const baseItemDirections = entryTextAdapter(
  'base_item_directions',
  (e) => (e.properties as { directions?: unknown } | undefined)?.directions,
  { getGuardName: (e) => e.name },
);

/** gems.json (poe1) — the descriptive paragraph under a skill gem's name. */
export const gemDescriptions = entryTextAdapter(
  'gem_descriptions',
  (e) => (e.active_skill as { description?: unknown } | null | undefined)?.description,
  { getGuardName: (e) => (e.active_skill as { display_name?: unknown } | null | undefined)?.display_name },
);

/** skills.json (poe2) — skill descriptions, keyed by granted-skill id. */
export const skillDescriptions = entryTextAdapter(
  'skill_descriptions',
  (e) => (e.active_skill as { description?: unknown } | null | undefined)?.description,
  { getGuardName: (e) => (e.active_skill as { display_name?: unknown } | null | undefined)?.display_name },
);

/** ascendancies.json (poe2): ascendancy id → { name, flavour_text, ... }. */
export const ascendancies = entryTextAdapter('ascendancies', (e) => e.name);

/** ascendancies.json — the flavour blurb, suppressed when the name is a placeholder. */
export const ascendancyFlavour = entryTextAdapter('ascendancy_flavour', (e) => e.flavour_text, {
  getGuardName: (e) => e.name,
});

/** keywords.json (poe2): keyword id → { term, definition } — the hover-tooltip terms. */
export const keywords = entryTextAdapter('keywords', (e) => e.term);

/** keywords.json — tooltip definition text, suppressed when the term is a placeholder. */
export const keywordDefinitions = entryTextAdapter('keyword_definitions', (e) => e.definition, {
  getGuardName: (e) => e.term,
});

export const ADAPTERS: Record<string, Adapter> = {
  base_items: baseItems,
  gems,
  skill_gems: skillGems,
  gem_tags: gemTags,
  item_classes: itemClasses,
  essences,
  fossils,
  uniques,
  stat_translations: statTranslations,
  passives: passiveNodes,
  mods,
  world_areas: worldAreas,
  buffs,
  buff_descriptions: buffDescriptions,
  flavour,
  characters,
  cluster_jewel_notables: clusterJewelNotables,
  cost_types: costTypes,
  base_item_descriptions: baseItemDescriptions,
  base_item_directions: baseItemDirections,
  gem_descriptions: gemDescriptions,
  skill_descriptions: skillDescriptions,
  ascendancies,
  ascendancy_flavour: ascendancyFlavour,
  keywords,
  keyword_definitions: keywordDefinitions,
};
