// Stage 2: Ingest / Construct. Reads one raw run, validates each file,
// applies the namespace adapters, and pivots everything into the in-memory
// term map keyed by (game, namespace, term_id) with per-locale values.
// English is the reference locale for key-set anomaly reporting; English
// text is never substituted into another locale.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ADAPTERS } from './adapters.ts';
import { GAME, LOCALES, NAMESPACES } from './config.ts';
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
  terms: Map<string, TermRecord>;
  report: IngestReport;
  manifest?: Manifest;
}

export function termKey(namespace: string, termId: string): string {
  return `${GAME}|${namespace}|${termId}`;
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

/** Ingests one raw run directory into the in-memory term map. */
export async function ingestRun(runDir: string): Promise<IngestResult> {
  let manifest: Manifest | undefined;
  try {
    manifest = JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    // Fixture/partial runs without a manifest are still ingestable.
  }

  const terms = new Map<string, TermRecord>();
  const report: IngestReport = {
    runId: manifest?.runId,
    source: manifest?.source,
    fileProblems: [],
    details: [],
    schemaNotes: [],
  };

  for (const ns of NAMESPACES) {
    // Load the schema once per namespace; absence degrades to adapter checks.
    let schema: object | undefined;
    const schemaData = await tryReadJson(join(runDir, 'schemas', `${ns.file}.json`)).catch(() => undefined);
    if (schemaData && typeof schemaData === 'object') {
      schema = schemaData;
    } else {
      report.schemaNotes.push(`${ns.file}: no schema in run; relying on adapter-level checks`);
    }

    const idsByLocale = new Map<string, Set<string>>();

    for (const locale of LOCALES) {
      const path = join(runDir, locale.code, `${ns.file}.json`);
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

      const { terms: extracted, anomalies } = ADAPTERS[ns.namespace](data);
      const ids = new Set<string>();
      for (const t of extracted) {
        ids.add(t.id);
        const key = termKey(ns.namespace, t.id);
        let record = terms.get(key);
        if (!record) {
          record = { namespace: ns.namespace, termId: t.id, values: new Map() };
          terms.set(key, record);
        }
        // Category metadata comes from English when available (reference locale).
        if (t.category && (locale.code === 'en' || record.category === undefined)) {
          record.category = t.category;
        }
        // Normalize to NFC so identical-looking strings compare equal.
        record.values.set(locale.code, t.text.normalize('NFC'));
      }
      idsByLocale.set(locale.code, ids);

      report.details.push({
        locale: locale.code,
        namespace: ns.namespace,
        termCount: ids.size,
        missingFromLocale: 0,
        missingSample: [],
        extraInLocale: 0,
        extraSample: [],
        notes: anomalies,
      });
    }

    // Key-set differences vs English (coverage skew / lagging locale dirs).
    const enIds = idsByLocale.get('en');
    if (enIds) {
      for (const detail of report.details) {
        if (detail.namespace !== ns.namespace || detail.locale === 'en') continue;
        const localeIds = idsByLocale.get(detail.locale)!;
        const missing = [...enIds].filter((id) => !localeIds.has(id));
        const extra = [...localeIds].filter((id) => !enIds.has(id));
        detail.missingFromLocale = missing.length;
        detail.missingSample = missing.slice(0, SAMPLE_LIMIT);
        detail.extraInLocale = extra.length;
        detail.extraSample = extra.slice(0, SAMPLE_LIMIT);
      }
    }
  }

  return { terms, report, manifest };
}
