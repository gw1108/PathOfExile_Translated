// Stage 2: Ingest / Construct. Reads one game's slice of a raw run,
// validates each file, applies the namespace adapters, and pivots everything
// into the in-memory term map keyed by (game, namespace, term_id) with
// per-locale values. English is the reference locale for key-set anomaly
// reporting; English text is never substituted into another locale.

import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ADAPTERS, stripMarkup, stripRenderMarkup } from './adapters.ts';
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
  const seenProblems = new Set<string>();
  const report: IngestReport = {
    runId: manifest?.runId,
    source: manifest?.source,
    fileProblems: [],
    details: [],
    schemaNotes: [],
  };
  // Several namespaces can share one raw file; report its absence once.
  const reportProblem = (problem: string) => {
    if (seenProblems.has(problem)) return;
    seenProblems.add(problem);
    report.fileProblems.push(problem);
  };
  if (!game.hasSchemas) {
    report.schemaNotes.push(`${game.game}: upstream publishes no JSON Schemas; relying on adapter-level checks`);
  }

  for (const ns of game.namespaces) {
    const adapter = ADAPTERS[ns.adapter ?? ns.namespace];
    if (!adapter) throw new Error(`no adapter registered for namespace ${ns.namespace}`);

    // A directory namespace reads every file enumerated in the ENGLISH raw
    // dir; each file's terms are prefixed with its basename. Regular
    // namespaces read exactly one file with no prefix.
    let sources: { file: string; prefix: string }[];
    if (ns.directory) {
      let bases: string[] = [];
      try {
        bases = (await readdir(join(root, 'en', ns.file)))
          .filter((n) => n.endsWith('.json'))
          .map((n) => n.replace(/\.json$/, ''))
          .sort();
      } catch {
        reportProblem(`en/${ns.file}: directory not present in run`);
      }
      sources = bases.map((base) => ({ file: `${ns.file}/${base}`, prefix: `${base}/` }));
    } else {
      sources = [{ file: ns.file, prefix: '' }];
    }

    // Load the schema once per namespace; absence degrades to adapter checks.
    let schema: object | undefined;
    if (game.hasSchemas && ns.validateSchema !== false && !ns.directory) {
      const schemaData = await tryReadJson(join(root, 'schemas', `${ns.file}.json`)).catch(() => undefined);
      if (schemaData && typeof schemaData === 'object') {
        schema = schemaData;
      } else {
        report.schemaNotes.push(`${ns.file}: no schema in run; relying on adapter-level checks`);
      }
    }

    const idsByLocale = new Map<string, Set<string>>();
    // Details created for THIS namespace entry. The key-set diff below must
    // not touch details of an earlier entry sharing the same namespace name
    // (a namespace like `passives` spans several files).
    const entryDetails: LocaleNamespaceReport[] = [];
    // Ids English skipped as dev placeholders ([DNT]/[UNUSED]/...). Localized
    // files often carry a real-looking translation for these dev-only items,
    // so they are suppressed in every locale. English is the first locale in
    // every game config, so the set is complete before other locales run.
    const enPlaceholderIds = new Set<string>();

    for (const locale of game.locales) {
      const ids = new Set<string>();
      const notes: string[] = [];
      let suppressed = 0;
      let markupStripped = 0;
      let anyFile = false;

      for (const src of sources) {
        const path = join(root, locale.code, `${src.file}.json`);
        let data: unknown;
        try {
          data = await tryReadJson(path);
        } catch (err) {
          reportProblem(`${locale.code}/${src.file}: unreadable (${err instanceof Error ? err.message : err})`);
          continue;
        }
        if (data === undefined) {
          reportProblem(`${locale.code}/${src.file}: not present in run`);
          continue;
        }
        anyFile = true;

        if (schema) {
          let errors: string[];
          try {
            errors = validateAgainstSchema(schema, data, `${locale.code}/${src.file}`);
          } catch (err) {
            report.schemaNotes.push(`${ns.file}: schema failed to compile (${err instanceof Error ? err.message : err}); relying on adapter-level checks`);
            schema = undefined;
            errors = [];
          }
          if (errors.length > 0) {
            throw new Error(
              `schema validation failed for ${locale.code}/${src.file} — upstream format may have changed:\n  ${errors.slice(0, 5).join('\n  ')}`,
            );
          }
        }

        const { terms: extracted, anomalies, placeholderIds } = adapter(data);
        notes.push(...anomalies.map((a) => (src.prefix ? `${src.prefix}${a}` : a)));
        if (locale.code === 'en') for (const id of placeholderIds ?? []) enPlaceholderIds.add(src.prefix + id);

        for (const t of extracted) {
          const termId = src.prefix + t.id;
          if (locale.code !== 'en' && enPlaceholderIds.has(termId)) {
            suppressed++;
            continue;
          }
          ids.add(termId);
          const key = termKey(game.game, ns.namespace, termId);
          let record = terms.get(key);
          if (!record) {
            record = { namespace: ns.namespace, termId, values: new Map() };
            terms.set(key, record);
          }
          // Category metadata comes from English when available (reference locale).
          if (t.category && (locale.code === 'en' || record.category === undefined)) {
            record.category = t.category;
          }
          // Keyword markup ([Chaos|caos] → caos) appears in every long-text
          // namespace (descriptions, keyword tooltips, ...), render markup in
          // localized names; both reduce to display text.
          const text = stripMarkup(stripRenderMarkup(t.text));
          if (text !== t.text) markupStripped++;
          // Normalize newlines and NFC so identical-looking strings compare equal.
          record.values.set(locale.code, text.replace(/\r\n/g, '\n').normalize('NFC'));
        }
      }
      if (!anyFile) continue;

      idsByLocale.set(locale.code, ids);
      if (suppressed > 0) {
        notes.push(`${ns.namespace}: suppressed ${suppressed} entries whose English name is a dev placeholder`);
      }
      if (markupStripped > 0) {
        notes.push(`${ns.namespace}: stripped render markup (<tag>{...}) from ${markupStripped} values`);
      }

      const detail: LocaleNamespaceReport = {
        locale: locale.code,
        namespace: ns.namespace,
        termCount: ids.size,
        missingFromLocale: 0,
        missingSample: [],
        extraInLocale: 0,
        extraSample: [],
        notes,
      };
      entryDetails.push(detail);
      report.details.push(detail);
    }

    // Variant-alignment guard for `[i]`-keyed namespaces: when a locale's
    // variant count for a stat-id tuple differs from English (upstream parse
    // drops, language-specific plural splits), positional pairing would
    // silently attach the wrong strings — drop that locale's entry instead.
    if (ns.variantKeyed) {
      const byBase = (ids: Set<string>) => {
        const m = new Map<string, string[]>();
        for (const id of ids) {
          const base = id.replace(/\[\d+\]$/, '');
          let list = m.get(base);
          if (!list) m.set(base, (list = []));
          list.push(id);
        }
        return m;
      };
      const enIdSet = idsByLocale.get('en');
      const enBases = enIdSet ? byBase(enIdSet) : undefined;
      if (enBases) {
        for (const locale of game.locales) {
          if (locale.code === 'en') continue;
          const ids = idsByLocale.get(locale.code);
          if (!ids) continue;
          let dropped = 0;
          for (const [base, localeIds] of byBase(ids)) {
            const enCount = enBases.get(base)?.length;
            if (enCount === undefined || enCount === localeIds.length) continue;
            for (const id of localeIds) {
              ids.delete(id);
              terms.get(termKey(game.game, ns.namespace, id))?.values.delete(locale.code);
            }
            dropped++;
          }
          if (dropped > 0) {
            const detail = entryDetails.find((d) => d.locale === locale.code);
            if (detail) {
              detail.termCount = ids.size;
              detail.notes.push(
                `${ns.namespace}: dropped ${dropped} entries whose variant count differs from English (positional pairing unsafe)`,
              );
            }
          }
        }
      }
    }

    // Key-set differences vs English. Missing ids are only reported (a term
    // absent from a locale is omitted, never filled with English). Extra ids
    // — strings with no English reference — are DROPPED after being
    // reported: with English empty they are invariably dev filler (e.g.
    // localized boilerplate on monster-internal skills), not translations.
    const enIds = idsByLocale.get('en');
    if (enIds) {
      for (const detail of entryDetails) {
        if (detail.locale === 'en') continue;
        const localeIds = idsByLocale.get(detail.locale);
        if (!localeIds) continue;
        const missing = [...enIds].filter((id) => !localeIds.has(id));
        const extra = [...localeIds].filter((id) => !enIds.has(id));
        detail.missingFromLocale = missing.length;
        detail.missingSample = missing.slice(0, SAMPLE_LIMIT);
        detail.extraInLocale = extra.length;
        detail.extraSample = extra.slice(0, SAMPLE_LIMIT);
        if (extra.length > 0) {
          for (const id of extra) {
            localeIds.delete(id);
            const record = terms.get(termKey(game.game, ns.namespace, id));
            record?.values.delete(detail.locale);
          }
          detail.termCount = localeIds.size;
          detail.notes.push(`${ns.namespace}: dropped ${extra.length} entries with no English reference (dev filler)`);
        }
      }
    }
  }

  return { game, terms, report, manifest };
}
