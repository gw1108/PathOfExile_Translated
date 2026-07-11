// Stage 3: Exporter. Walks the in-memory term map once per locale and emits
// dist/poe1/<locale>.json — flat { "namespace.term_id": "localized string" } —
// plus index.json with provenance, counts, and anomaly summaries.
//
// Output rules (see Plan.md): UTF-8 without BOM, raw non-ASCII (no \uXXXX
// escaping), keys sorted for stable diffs.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GAME, LOCALES, NAMESPACES } from './config.ts';
import type { IngestResult } from './ingest.ts';

export interface ExportSummary {
  outDir: string;
  contentHash: string;
  localeCounts: Record<string, number>;
}

/** Builds the flat export object for one locale, keys sorted. */
export function buildLocaleExport(result: IngestResult, localeCode: string): Record<string, string> {
  const pairs: [string, string][] = [];
  for (const record of result.terms.values()) {
    const value = record.values.get(localeCode);
    if (value !== undefined && value !== '') {
      pairs.push([`${record.namespace}.${record.termId}`, value]);
    }
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(pairs);
}

/** Serializes with raw UTF-8 (JSON.stringify never \u-escapes non-ASCII). */
function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

export async function exportRun(result: IngestResult, distRoot = 'dist'): Promise<ExportSummary> {
  const outDir = join(distRoot, GAME);
  await mkdir(outDir, { recursive: true });

  const localeCounts: Record<string, number> = {};
  const localeFileHashes: Record<string, string> = {};

  for (const locale of LOCALES) {
    const flat = buildLocaleExport(result, locale.code);
    const count = Object.keys(flat).length;
    if (count === 0) continue; // locale not fetched/usable this run — omit, never substitute
    const body = toJson(flat);
    await writeFile(join(outDir, `${locale.code}.json`), body, 'utf8');
    localeCounts[locale.code] = count;
    localeFileHashes[locale.code] = createHash('sha256').update(body, 'utf8').digest('hex');
  }

  // Deterministic hash of the exported dictionary content (excludes this
  // index and all volatile timestamps) — CI commits only when this changes.
  const contentHash = createHash('sha256')
    .update(Object.entries(localeFileHashes).sort(([a], [b]) => (a < b ? -1 : 1)).map(([l, h]) => `${l}:${h}`).join('\n'))
    .digest('hex');

  const namespaceCounts: Record<string, number> = {};
  for (const ns of NAMESPACES) namespaceCounts[ns.namespace] = 0;
  for (const record of result.terms.values()) {
    if (record.values.has('en')) namespaceCounts[record.namespace]++;
  }

  const fetchProvenance: Record<string, { file: string; url: string; sha256: string; fetchedAt: string }[]> = {};
  for (const f of result.manifest?.files ?? []) {
    (fetchProvenance[f.locale] ??= []).push({ file: f.file, url: f.url, sha256: f.sha256, fetchedAt: f.fetchedAt });
  }

  const anomalies = result.report.details
    .filter((d) => d.missingFromLocale > 0 || d.extraInLocale > 0 || d.notes.length > 0)
    .map((d) => ({
      locale: d.locale,
      namespace: d.namespace,
      missingFromLocale: d.missingFromLocale,
      missingSample: d.missingSample,
      extraInLocale: d.extraInLocale,
      extraSample: d.extraSample,
      notes: d.notes,
    }));

  const index = {
    game: GAME,
    generatedAt: new Date().toISOString(),
    runId: result.report.runId ?? null,
    source: result.report.source ?? null,
    contentHash,
    keyFormat:
      'Keys are "<namespace>.<term_id>", split on the FIRST dot; term_id is the '
      + "game's internal id (metadata path, gem id, tag id, ...), except the "
      + 'uniques namespace, which is keyed by English display name because '
      + 'upstream exposes no internal id for uniques.',
    disclaimer:
      'All game terminology is the property of Grinding Gear Games, extracted '
      + 'via the RePoE fork (https://repoe-fork.github.io/). Not affiliated '
      + 'with or endorsed by Grinding Gear Games.',
    locales: Object.fromEntries(
      Object.entries(localeCounts).map(([code, terms]) => [
        code,
        {
          file: `${code}.json`,
          terms,
          sha256: localeFileHashes[code],
          fetched: fetchProvenance[code] ?? [],
        },
      ]),
    ),
    namespaces: namespaceCounts,
    fileProblems: result.report.fileProblems,
    schemaNotes: result.report.schemaNotes,
    anomalies,
  };

  await writeFile(join(outDir, 'index.json'), toJson(index), 'utf8');
  return { outDir, contentHash, localeCounts };
}
