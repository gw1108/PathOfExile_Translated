// Stage 2: Ingest / Construct. Reads one game's slice of a raw run,
// validates each file, applies the namespace adapters, and pivots everything
// into the in-memory term map keyed by (game, namespace, term_id) with
// per-locale values. English is the reference locale for key-set anomaly
// reporting; English text is never substituted into another locale.

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ADAPTERS, stripRenderMarkup } from './adapters.ts';
import { gameConfig, type GameConfig } from './config.ts';
import type { Manifest } from './fetch.ts';
import { validateAgainstSchema } from './validate.ts';

export interface TermRecord {
  namespace: string;
  termId: string;
  category?: string;
  values: Map<string, string>; // locale code → localized string
}

export interface LocaleNamespaceReport {
  locale: string;
  namespace: string;
  /** Terms this locale contributed for this namespace. */
  termCount: number;
  /** IDs present in English but absent from this locale (count + sample). */
  missingFromLocale: number;
  missingSample: string[];
  /** IDs present in this locale but absent from English (count + sample). */
  extraInLocale: number;
  extraSample: string[];
  /** Adapter-level notes (skipped empties, dedupes, ...). */
  notes: string[];
}

export interface IngestReport {
  runId?: string;
  source?: string;
  /** Files that could not be read/parsed/validated, with reasons. */
  fileProblems: string[];
  /** Per locale × namespace detail. */
  details: LocaleNamespaceReport[];
  /** Schema validation coverage notes (missing schema → adapter checks only). */
  schemaNotes: string[];
}

export interface IngestResult {
  game: GameConfig;
  terms: Map<string, TermRecord>;
  report: IngestReport;
  manifest?: Manifest;
}

export function termKey(game: string, namespace: string, termId: string): string {
  return `${game}|${namespace}|${termId}`;
}

const SAMPLE_LIMIT = 20;

async function tryReadJson(path: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined; // absent file — recorded by caller
  }
  return JSON.parse(text); // parse errors propagate: fail loudly
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Root directory of one game's files inside a raw run. Current layout is
 * raw/<run-id>/<game>/<locale>/...; runs fetched before multi-game support
 * (and the test fixtures) put poe1's locale dirs directly under the run dir.
 */
async function gameRoot(runDir: string, game: GameConfig): Promise<string> {
  const nested = join(runDir, game.game);
  if (await exists(nested)) return nested;
  return game.game === 'poe1' ? runDir : nested;
}

/** Ingests one game's portion of a raw run directory into the in-memory term map. */
export async function ingestRun(runDir: string, game: GameConfig = gameConfig('poe1')): Promise<IngestResult> {
  let manifest: Manifest | undefined;
  try {
    manifest = JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    // Fixture/partial runs without a manifest are still ingestable.
  }

  const root = await gameRoot(runDir, game);
  const terms = new Map<string, TermRecord>();
  const report: IngestReport = {
    runId: manifest?.runId,
    source: manifest?.source,
    fileProblems: [],
    details: [],
    schemaNotes: [],
  };
  if (!game.hasSchemas) {
    report.schemaNotes.push(`${game.game}: upstream publishes no JSON Schemas; relying on adapter-level checks`);
  }

  for (const ns of game.namespaces) {
    // Load the schema once per namespace; absence degrades to adapter checks.
    let schema: object | undefined;
    if (game.hasSchemas) {
      const schemaData = await tryReadJson(join(root, 'schemas', `${ns.file}.json`)).catch(() => undefined);
      if (schemaData && typeof schemaData === 'object') {
        schema = schemaData;
      } else {
        report.schemaNotes.push(`${ns.file}: no schema in run; relying on adapter-level checks`);
      }
    }

    const idsByLocale = new Map<string, Set<string>>();
    // Ids English skipped as dev placeholders ([DNT]/[UNUSED]/...). Localized
    // files often carry a real-looking translation for these dev-only items,
    // so they are suppressed in every locale. English is the first locale in
    // every game config, so the set is complete before other locales run.
    const enPlaceholderIds = new Set<string>();

    for (const locale of game.locales) {
      const path = join(root, locale.code, `${ns.file}.json`);
      let data: unknown;
      try {
        data = await tryReadJson(path);
      } catch (err) {
        report.fileProblems.push(`${locale.code}/${ns.file}: unreadable (${err instanceof Error ? err.message : err})`);
        continue;
      }
      if (data === undefined) {
        report.fileProblems.push(`${locale.code}/${ns.file}: not present in run`);
        continue;
      }

      if (schema) {
        let errors: string[];
        try {
          errors = validateAgainstSchema(schema, data, `${locale.code}/${ns.file}`);
        } catch (err) {
          report.schemaNotes.push(`${ns.file}: schema failed to compile (${err instanceof Error ? err.message : err}); relying on adapter-level checks`);
          schema = undefined;
          errors = [];
        }
        if (errors.length > 0) {
          throw new Error(
            `schema validation failed for ${locale.code}/${ns.file} — upstream format may have changed:\n  ${errors.slice(0, 5).join('\n  ')}`,
          );
        }
      }

      const { terms: extracted, anomalies, placeholderIds } = ADAPTERS[ns.namespace](data);
      const notes = [...anomalies];
      if (locale.code === 'en') for (const id of placeholderIds ?? []) enPlaceholderIds.add(id);
      const ids = new Set<string>();
      let suppressed = 0;
      let markupStripped = 0;
      for (const t of extracted) {
        if (locale.code !== 'en' && enPlaceholderIds.has(t.id)) {
          suppressed++;
          continue;
        }
        ids.add(t.id);
        const key = termKey(game.game, ns.namespace, t.id);
        let record = terms.get(key);
        if (!record) {
          record = { namespace: ns.namespace, termId: t.id, values: new Map() };
          terms.set(key, record);
        }
        // Category metadata comes from English when available (reference locale).
        if (t.category && (locale.code === 'en' || record.category === undefined)) {
          record.category = t.category;
        }
        const text = stripRenderMarkup(t.text);
        if (text !== t.text) markupStripped++;
        // Normalize to NFC so identical-looking strings compare equal.
        record.values.set(locale.code, text.normalize('NFC'));
      }
      idsByLocale.set(locale.code, ids);
      if (suppressed > 0) {
        notes.push(`${ns.namespace}: suppressed ${suppressed} entries whose English name is a dev placeholder`);
      }
      if (markupStripped > 0) {
        notes.push(`${ns.namespace}: stripped render markup (<size:N>{...}) from ${markupStripped} values`);
      }

      report.details.push({
        locale: locale.code,
        namespace: ns.namespace,
        termCount: ids.size,
        missingFromLocale: 0,
        missingSample: [],
        extraInLocale: 0,
        extraSample: [],
        notes,
      });
    }

    // Key-set differences vs English (coverage skew / lagging locale dirs).
    const enIds = idsByLocale.get('en');
    if (enIds) {
      for (const detail of report.details) {
        if (detail.namespace !== ns.namespace || detail.locale === 'en') continue;
        const localeIds = idsByLocale.get(detail.locale);
        if (!localeIds) continue;
        const missing = [...enIds].filter((id) => !localeIds.has(id));
        const extra = [...localeIds].filter((id) => !enIds.has(id));
        detail.missingFromLocale = missing.length;
        detail.missingSample = missing.slice(0, SAMPLE_LIMIT);
        detail.extraInLocale = extra.length;
        detail.extraSample = extra.slice(0, SAMPLE_LIMIT);
      }
    }
  }

  return { game, terms, report, manifest };
}
