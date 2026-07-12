// Central configuration: games, locales, namespaces, upstream layout.
// The locale table is the single source of truth for what exists upstream —
// see Plan.md ("Locale set"). Do not invent locales the source doesn't ship.

export const UPSTREAM_BASE = 'https://repoe-fork.github.io';

/** Path (under the upstream base) where the JSON Schemas live. */
export const SCHEMA_DIR = 'data-formats';

export interface LocaleConfig {
  /** BCP 47 code used for export filenames and internal locale keys. */
  code: string;
  /** Upstream directory name; empty string means the root (English). */
  dir: string;
}

// Both games ship the same ten languages (see RePoE run_parser.py LANGS).
// For poe1 the localized directories are published on the site; for poe2
// upstream currently exports English only, so the other nine 404 until either
// upstream adds `-l all` to its poe2 workflow or the data is generated
// locally with the RePoE parser and fetched via --source.
export const LOCALES: readonly LocaleConfig[] = [
  { code: 'en', dir: '' },
  { code: 'fr', dir: 'French' },
  { code: 'de', dir: 'German' },
  { code: 'es', dir: 'Spanish' },
  { code: 'pt-BR', dir: 'Portuguese' },
  { code: 'ru', dir: 'Russian' },
  { code: 'ja', dir: 'Japanese' },
  { code: 'ko', dir: 'Korean' },
  { code: 'th', dir: 'Thai' },
  { code: 'zh-Hant', dir: 'Traditional Chinese' },
];

export interface NamespaceConfig {
  /**
   * Namespace segment used in exported keys ("namespace.term_id") and as the
   * dist/<game>/<namespace>/ folder. May contain slashes (nested folders).
   */
  namespace: string;
  /**
   * Upstream file path relative to the locale root, without extension
   * (fetched as `<file>.min.json`). May contain subdirectories. Several
   * namespaces may share one file (e.g. buffs + buff_descriptions); the
   * fetcher downloads it once.
   */
  file: string;
  /**
   * ADAPTERS key to extract this namespace's terms. Defaults to `namespace`.
   */
  adapter?: string;
  /**
   * True when `file` is a DIRECTORY of translation files (poe2's
   * specific_skill_stat_descriptions). The fetcher enumerates it (readdir for
   * local mirrors, generated index.html for the site) and term ids are
   * prefixed with each file's basename.
   */
  directory?: boolean;
  /**
   * Set false to skip JSON-Schema validation for this file even when the
   * game publishes schemas — e.g. stat_translations, whose schema names the
   * language key "English" and would reject every localized file.
   */
  validateSchema?: boolean;
  /**
   * True when term ids end in a positional `[variant index]`
   * (stat_translations). Ingest then drops a locale's entry when its variant
   * count differs from English, since index alignment would silently pair
   * the wrong strings.
   */
  variantKeyed?: boolean;
}

export interface GameConfig {
  /** Game id: also the dist/ and raw-run subdirectory name. */
  game: string;
  /** Subpath under the upstream base where this game's export lives ('' = site root). */
  upstreamPath: string;
  /** Whether upstream publishes JSON Schemas (data-formats/) for this game. */
  hasSchemas: boolean;
  locales: readonly LocaleConfig[];
  namespaces: readonly NamespaceConfig[];
}

const statTranslationNs = (namespace: string, file: string): NamespaceConfig => ({
  namespace,
  file,
  adapter: 'stat_translations',
  validateSchema: false,
  variantKeyed: true,
});

// poe1's stat_translations/ subdirectory files (site publishes these flat,
// short-named). The root stat_translations.json is the main item-mod text.
const POE1_STAT_TRANSLATION_FILES = [
  'active_skill_gem', 'advanced_mod', 'areas', 'atlas', 'atlas_relic',
  'aura_skill', 'banner_aura_skill', 'beam_skill', 'brand_skill', 'buff_skill',
  'curse_skill', 'debuff_skill', 'expedition_relic', 'graft', 'heist_equipment',
  'leaguestone', 'mercenary_support', 'minion_attack_skill', 'minion_skill',
  'minion_spell_damage_skill', 'minion_spell_skill', 'mirage', 'monster',
  'necropolis', 'offering_skill', 'passive_skill', 'passive_skill_aura',
  'primordial_altar', 'sanctum_relic', 'secondary_debuff_skill', 'sentinel',
  'single_minion_spell_skill', 'skill', 'strongbox', 'support_gem', 'tincture',
  'vaal_side_area', 'variable_duration_skill', 'village',
] as const;

// poe2's stat_translations/ files use long `<name>_stat_descriptions` file
// names; namespaces use the short name so keys stay parallel with poe1.
const POE2_STAT_TRANSLATION_FILES = [
  'active_skill_gem', 'advanced_mod', 'atlas', 'atlas_variant',
  'character_panel', 'character_panel_gamepad', 'chest', 'endgame_map',
  'expedition_relic', 'expedition_relic_special', 'gem', 'heist_equipment',
  'leaguestone', 'map', 'map_temple_room', 'meta_gem', 'monster',
  'passive_skill', 'passive_skill_aura', 'passive_skill_variant',
  'primordial_altar', 'sanctum_relic', 'sentinel', 'skill', 'tablet',
  'utility_flask_buff',
] as const;

export const GAMES: readonly GameConfig[] = [
  {
    game: 'poe1',
    upstreamPath: '',
    hasSchemas: true,
    locales: LOCALES,
    namespaces: [
      { namespace: 'base_items', file: 'base_items' },
      { namespace: 'base_item_descriptions', file: 'base_items', adapter: 'base_item_descriptions' },
      { namespace: 'base_item_directions', file: 'base_items', adapter: 'base_item_directions' },
      { namespace: 'gems', file: 'gems' },
      { namespace: 'gem_descriptions', file: 'gems', adapter: 'gem_descriptions' },
      { namespace: 'gem_tags', file: 'gem_tags' },
      { namespace: 'item_classes', file: 'item_classes' },
      { namespace: 'essences', file: 'essences' },
      { namespace: 'fossils', file: 'fossils' },
      { namespace: 'uniques', file: 'uniques' },
      { namespace: 'mods', file: 'mods', validateSchema: false },
      { namespace: 'world_areas', file: 'world_areas', validateSchema: false },
      { namespace: 'buffs', file: 'buffs', validateSchema: false },
      { namespace: 'buff_descriptions', file: 'buffs', adapter: 'buff_descriptions', validateSchema: false },
      { namespace: 'flavour', file: 'flavour', validateSchema: false },
      { namespace: 'characters', file: 'characters', validateSchema: false },
      { namespace: 'cost_types', file: 'cost_types', validateSchema: false },
      { namespace: 'cluster_jewel_notables', file: 'cluster_jewel_notables', validateSchema: false },
      { namespace: 'passives', file: 'passive_skill_trees/Default', validateSchema: false },
      { namespace: 'passives', file: 'passive_skill_trees/Atlas', validateSchema: false },
      statTranslationNs('stat_translations', 'stat_translations'),
      ...POE1_STAT_TRANSLATION_FILES.map((f) => statTranslationNs(`stat_translations/${f}`, `stat_translations/${f}`)),
    ],
  },
  {
    // poe2's export mirrors poe1's formats where possible, but the file set
    // differs: gems.json is skill_gems.json (different shape), gem/skill
    // descriptions live in skills.json, and there are no essences/fossils.
    game: 'poe2',
    upstreamPath: 'poe2',
    hasSchemas: false,
    locales: LOCALES,
    namespaces: [
      { namespace: 'base_items', file: 'base_items' },
      { namespace: 'base_item_descriptions', file: 'base_items', adapter: 'base_item_descriptions' },
      { namespace: 'base_item_directions', file: 'base_items', adapter: 'base_item_directions' },
      { namespace: 'skill_gems', file: 'skill_gems' },
      { namespace: 'skill_descriptions', file: 'skills', adapter: 'skill_descriptions' },
      { namespace: 'gem_tags', file: 'gem_tags' },
      { namespace: 'item_classes', file: 'item_classes' },
      { namespace: 'uniques', file: 'uniques' },
      { namespace: 'mods', file: 'mods' },
      { namespace: 'world_areas', file: 'world_areas' },
      { namespace: 'buffs', file: 'buffs' },
      { namespace: 'buff_descriptions', file: 'buffs', adapter: 'buff_descriptions' },
      { namespace: 'flavour', file: 'flavour' },
      { namespace: 'characters', file: 'characters' },
      { namespace: 'cost_types', file: 'cost_types' },
      { namespace: 'ascendancies', file: 'ascendancies' },
      { namespace: 'ascendancy_flavour', file: 'ascendancies', adapter: 'ascendancy_flavour' },
      { namespace: 'keywords', file: 'keywords' },
      { namespace: 'keyword_definitions', file: 'keywords', adapter: 'keyword_definitions' },
      { namespace: 'passives', file: 'passive_skill_trees/Default' },
      { namespace: 'passives', file: 'passive_skill_trees/Atlas' },
      { namespace: 'passives', file: 'passive_skill_trees/EndgameMap' },
      { namespace: 'passives', file: 'passive_skill_trees/BrequelTree' },
      // poe2 has no root stat_translations.json; its main item-mod text is
      // stat_translations/stat_descriptions — exported under the same
      // 'stat_translations' namespace as poe1's root file.
      statTranslationNs('stat_translations', 'stat_translations/stat_descriptions'),
      ...POE2_STAT_TRANSLATION_FILES.map((f) =>
        statTranslationNs(`stat_translations/${f}`, `stat_translations/${f}_stat_descriptions`)),
      {
        ...statTranslationNs('stat_translations/specific_skill', 'stat_translations/specific_skill_stat_descriptions'),
        directory: true,
      },
    ],
  },
];

export function gameConfig(game: string): GameConfig {
  const config = GAMES.find((g) => g.game === game);
  if (!config) throw new Error(`unknown game "${game}" (expected one of: ${GAMES.map((g) => g.game).join(', ')})`);
  return config;
}

export const RAW_DIR = 'raw';
export const DIST_DIR = 'dist';

/** Upstream URL (or local mirror path) of one locale's data file. */
export function upstreamFileUrl(base: string, game: GameConfig, localeDir: string, file: string): string {
  const name = `${file}.min.json`;
  const isUrl = /^https?:\/\//.test(base);
  const gameDir = game.upstreamPath === '' ? '' : `${game.upstreamPath}/`;
  const dir = localeDir === '' ? '' : `${isUrl ? encodeURIComponent(localeDir) : localeDir}/`;
  return `${base.replace(/\/$/, '')}/${gameDir}${dir}${name}`;
}

/** Upstream URL (or local mirror path) of one locale's data DIRECTORY. */
export function upstreamDirUrl(base: string, game: GameConfig, localeDir: string, dir: string): string {
  const isUrl = /^https?:\/\//.test(base);
  const gameDir = game.upstreamPath === '' ? '' : `${game.upstreamPath}/`;
  const locale = localeDir === '' ? '' : `${isUrl ? encodeURIComponent(localeDir) : localeDir}/`;
  return `${base.replace(/\/$/, '')}/${gameDir}${locale}${dir}`;
}

/** Upstream URL (or local mirror path) of one file's JSON Schema. */
export function upstreamSchemaUrl(base: string, file: string): string {
  return `${base.replace(/\/$/, '')}/${SCHEMA_DIR}/${file}.json`;
}
