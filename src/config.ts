// Central configuration: games, locales, namespaces, upstream layout.
// The locale table is the single source of truth for what exists upstream —
// see Plan.md ("Locale set"). Do not invent locales the source doesn't ship.

export const GAME = 'poe1';

export const UPSTREAM_BASE = 'https://repoe-fork.github.io';

/** Path (under the upstream base) where the JSON Schemas live. */
export const SCHEMA_DIR = 'data-formats';

export interface LocaleConfig {
  /** BCP 47 code used for export filenames and internal locale keys. */
  code: string;
  /** Upstream directory name; empty string means the root (English). */
  dir: string;
}

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

export const NAMESPACES: readonly NamespaceConfig[] = [
  { namespace: 'base_items', file: 'base_items' },
  { namespace: 'gems', file: 'gems' },
  { namespace: 'gem_tags', file: 'gem_tags' },
  { namespace: 'item_classes', file: 'item_classes' },
  { namespace: 'essences', file: 'essences' },
  { namespace: 'fossils', file: 'fossils' },
  { namespace: 'uniques', file: 'uniques' },
];

export const RAW_DIR = 'raw';
export const DIST_DIR = 'dist';

/** Upstream URL (or local mirror path) of one locale's data file. */
export function upstreamFileUrl(base: string, localeDir: string, file: string): string {
  const name = `${file}.min.json`;
  const isUrl = /^https?:\/\//.test(base);
  const dir = localeDir === '' ? '' : `${isUrl ? encodeURIComponent(localeDir) : localeDir}/`;
  return `${base.replace(/\/$/, '')}/${dir}${name}`;
}

/** Upstream URL (or local mirror path) of one file's JSON Schema. */
export function upstreamSchemaUrl(base: string, file: string): string {
  return `${base.replace(/\/$/, '')}/${SCHEMA_DIR}/${file}.json`;
}
