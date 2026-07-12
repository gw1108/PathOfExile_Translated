// Stage 3: Exporter. Walks the in-memory term map and emits, per game:
//
//   dist/<game>/full/<locale>.json          every string, "namespace.term_id" keys
//   dist/<game>/<namespace>/<locale>.json   one namespace, bare term_id keys
//   dist/<game>/index.json                  provenance, counts, anomaly summaries
//
// Namespace folders may nest (stat_translations/skill/en.json). Output rules
// (see Plan.md): UTF-8 without BOM, raw non-ASCII (no \uXXXX escaping), keys
// sorted for stable diffs. The game's dist dir is rebuilt from scratch each
// run so removed namespaces/locales never linger.

import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DIST_DIR } from './config.ts';
import type { IngestResult } from './ingest.ts';

export interface ExportSummary {
  outDir: string;
  contentHash: string;
  localeCounts: Record<string, number>;
}

const sortPairs = (pairs: [string, string][]) => {
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(pairs);
};

/** Builds the flat full-dictionary object for one locale ("namespace.term_id" keys, sorted). */
export function buildLocaleExport(result: IngestResult, localeCode: string): Record<string, string> {
  const pairs: [string, string][] = [];
  for (const record of result.terms.values()) {
    const value = record.values.get(localeCode);
    if (value !== undefined && value !== '') {
      pairs.push([`${record.namespace}.${record.termId}`, value]);
    }
  }
  return sortPairs(pairs);
}

/** Builds one namespace's object for one locale (bare term_id keys, sorted). */
export function buildNamespaceExport(result: IngestResult, namespace: string, localeCode: string): Record<string, string> {
  const pairs: [string, string][] = [];
  for (const record of result.terms.values()) {
    if (record.namespace !== namespace) continue;
    const value = record.values.get(localeCode);
    if (value !== undefined && value !== '') {
      pairs.push([record.termId, value]);
    }
  }
  return sortPairs(pairs);
}

/** Serializes with raw UTF-8 (JSON.stringify never \u-escapes non-ASCII). */
function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

export async function exportRun(result: IngestResult, distRoot = DIST_DIR): Promise<ExportSummary> {
  const game = result.game;
  const outDir = join(distRoot, game.game);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const localeCounts: Record<string, number> = {};
  const localeFileHashes: Record<string, string> = {};

  // full/<locale>.json — the merged dictionary; its hashes are the content
  // fingerprint (every namespace file is a subset of it).
  for (const locale of game.locales) {
    const flat = buildLocaleExport(result, locale.code);
    const count = Object.keys(flat).length;
    if (count === 0) continue; // locale not fetched/usable this run — omit, never substitute
    const body = toJson(flat);
    const path = join(outDir, 'full', `${locale.code}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, 'utf8');
    localeCounts[locale.code] = count;
    localeFileHashes[locale.code] = createHash('sha256').update(body, 'utf8').digest('hex');
  }

  // <namespace>/<locale>.json — per-namespace slices with bare term ids.
  const namespaceNames = [...new Set(game.namespaces.map((ns) => ns.namespace))];
  const namespaceCounts: Record<string, number> = {};
  for (const namespace of namespaceNames) {
    namespaceCounts[namespace] = 0;
    for (const locale of game.locales) {
      const flat = buildNamespaceExport(result, namespace, locale.code);
      const count = Object.keys(flat).length;
      if (count === 0) continue;
      if (locale.code === 'en') namespaceCounts[namespace] = count;
      const path = join(outDir, namespace, `${locale.code}.json`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, toJson(flat), 'utf8');
    }
  }

  // Deterministic hash of the exported dictionary content (excludes the
  // index and all volatile timestamps) — CI commits only when this changes.
  const contentHash = createHash('sha256')
    .update(Object.entries(localeFileHashes).sort(([a], [b]) => (a < b ? -1 : 1)).map(([l, h]) => `${l}:${h}`).join('\n'))
    .digest('hex');

  const fetchProvenance: Record<string, { file: string; url: string; sha256: string; fetchedAt: string }[]> = {};
  for (const f of result.manifest?.files ?? []) {
    // Manifests from single-game runs predate the per-file game field.
    if ((f.game ?? 'poe1') !== game.game) continue;
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
    game: game.game,
    generatedAt: new Date().toISOString(),
    runId: result.report.runId ?? null,
    source: result.report.source ?? null,
    contentHash,
    layout:
      'full/<locale>.json holds every string with "<namespace>.<term_id>" keys '
      + '(split on the FIRST dot; namespaces may contain slashes, term ids may '
      + 'contain dots). <namespace>/<locale>.json holds one namespace with bare '
      + 'term_id keys.',
    keyFormat:
      "term_id is the game's internal id (metadata path, gem id, tag id, node "
      + 'id, ...) with two documented exceptions: uniques are keyed by English '
      + 'display name (upstream exposes no internal id), and stat_translations '
      + 'are keyed "<stat ids joined by space>[<variant index>]" with numeric '
      + 'placeholders normalized to #.',
    disclaimer:
      'All game terminology is the property of Grinding Gear Games, extracted '
      + 'via the RePoE fork (https://repoe-fork.github.io/). Not affiliated '
      + 'with or endorsed by Grinding Gear Games.',
    locales: Object.fromEntries(
      Object.entries(localeCounts).map(([code, terms]) => [
        code,
        {
          file: `full/${code}.json`,
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
