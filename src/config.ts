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
  /** Namespace segment used in exported keys ("namespace.term_id"). */
  namespace: string;
  /** Upstream file basename (fetched as `<file>.min.json`). */
  file: string;
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

export const GAMES: readonly GameConfig[] = [
  {
    game: 'poe1',
    upstreamPath: '',
    hasSchemas: true,
    locales: LOCALES,
    namespaces: [
      { namespace: 'base_items', file: 'base_items' },
      { namespace: 'gems', file: 'gems' },
      { namespace: 'gem_tags', file: 'gem_tags' },
      { namespace: 'item_classes', file: 'item_classes' },
      { namespace: 'essences', file: 'essences' },
      { namespace: 'fossils', file: 'fossils' },
      { namespace: 'uniques', file: 'uniques' },
    ],
  },
  {
    // poe2's export mirrors poe1's formats where possible, but the file set
    // differs: gems.json is skill_gems.json (different shape), and there are
    // no essences/fossils files.
    game: 'poe2',
    upstreamPath: 'poe2',
    hasSchemas: false,
    locales: LOCALES,
    namespaces: [
      { namespace: 'base_items', file: 'base_items' },
      { namespace: 'skill_gems', file: 'skill_gems' },
      { namespace: 'gem_tags', file: 'gem_tags' },
      { namespace: 'item_classes', file: 'item_classes' },
      { namespace: 'uniques', file: 'uniques' },
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

/** Upstream URL (or local mirror path) of one file's JSON Schema. */
export function upstreamSchemaUrl(base: string, file: string): string {
  return `${base.replace(/\/$/, '')}/${SCHEMA_DIR}/${file}.json`;
}
