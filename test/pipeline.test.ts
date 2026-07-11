import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildLocaleExport, exportRun } from '../src/export.ts';
import { ingestRun } from '../src/ingest.ts';

const FIXTURE_RUN = join(import.meta.dirname, 'fixtures', 'run');

test('golden: fixture run ingests and exports exact per-locale dictionaries', async () => {
  const result = await ingestRun(FIXTURE_RUN);

  assert.deepEqual(buildLocaleExport(result, 'en'), {
    'base_items.Metadata/Items/Amulets/Amulet1': 'Coral Amulet',
    'base_items.Metadata/Items/Currency/CurrencyRerollRare': 'Chaos Orb',
    'base_items.Metadata/Items/OnlyInEnglish': 'English Only Item',
    'gem_tags.cold': 'Cold',
    'gem_tags.fire': 'Fire',
    'uniques.Redbeak': 'Redbeak',
  });
  assert.deepEqual(buildLocaleExport(result, 'es'), {
    'base_items.Metadata/Items/Amulets/Amulet1': 'Amuleto de coral acentuadó',
    'base_items.Metadata/Items/Currency/CurrencyRerollRare': 'Orbe del caos',
    'base_items.Metadata/Items/OnlyInSpanish': 'Solo en español',
    'gem_tags.cold': 'Frío',
    'gem_tags.fire': 'Fuego',
    'uniques.Redbeak': 'Pico rojo',
  });
});

test('invariants: no empty values, no English substituted into other locales, NFC output', async () => {
  const result = await ingestRun(FIXTURE_RUN);
  for (const code of ['en', 'es']) {
    for (const [key, value] of Object.entries(buildLocaleExport(result, code))) {
      assert.notEqual(value, '', `${code}:${key} is empty`);
      assert.equal(value, value.normalize('NFC'), `${code}:${key} not NFC`);
    }
  }
  const en = buildLocaleExport(result, 'en');
  const es = buildLocaleExport(result, 'es');
  // The unreleased English entry never appears anywhere.
  assert.ok(!('base_items.Metadata/Items/Hidden/Secret' in en));
  // Terms absent from a locale are omitted, never filled with English.
  assert.ok(!('base_items.Metadata/Items/OnlyInEnglish' in es));
  // Localized text is the locale's own, not English.
  assert.notEqual(es['uniques.Redbeak'], en['uniques.Redbeak']);
});

test('anomaly report: key-set differences vs English are recorded', async () => {
  const { report } = await ingestRun(FIXTURE_RUN);
  const esBaseItems = report.details.find((d) => d.locale === 'es' && d.namespace === 'base_items');
  assert.ok(esBaseItems);
  assert.equal(esBaseItems.missingFromLocale, 1);
  assert.deepEqual(esBaseItems.missingSample, ['Metadata/Items/OnlyInEnglish']);
  assert.equal(esBaseItems.extraInLocale, 1);
  assert.deepEqual(esBaseItems.extraSample, ['Metadata/Items/OnlyInSpanish']);
  // Files absent from the fixture run are reported, not silently skipped.
  assert.ok(report.fileProblems.some((p) => p.includes('en/gems')));
});

test('exportRun writes sorted UTF-8 files without BOM plus index.json with provenance', async () => {
  const result = await ingestRun(FIXTURE_RUN);
  const distRoot = await mkdtemp(join(tmpdir(), 'poe-dist-'));
  const summary = await exportRun(result, distRoot);

  assert.deepEqual(summary.localeCounts, { en: 6, es: 6 });

  const buf = await readFile(join(distRoot, 'poe1', 'es.json'));
  assert.notEqual(buf[0], 0xef, 'file must not start with a BOM');
  const es = JSON.parse(buf.toString('utf8'));
  const keys = Object.keys(es);
  assert.deepEqual(keys, [...keys].sort(), 'keys must be sorted');
  assert.ok(buf.toString('utf8').includes('español'), 'non-ASCII must be raw UTF-8, not \\u-escaped');

  const index = JSON.parse(await readFile(join(distRoot, 'poe1', 'index.json'), 'utf8'));
  assert.equal(index.game, 'poe1');
  assert.equal(index.runId, 'fixture-run');
  assert.equal(index.locales.en.terms, 6);
  assert.equal(index.locales.en.fetched.length, 1);
  assert.equal(index.locales.en.fetched[0].sha256, 'aaaa');
  assert.ok(index.contentHash.match(/^[0-9a-f]{64}$/));
  assert.ok(index.anomalies.some((a: { locale: string; missingFromLocale: number }) => a.locale === 'es' && a.missingFromLocale === 1));
});

test('export content hash is stable across rebuilds of identical content', async () => {
  const result = await ingestRun(FIXTURE_RUN);
  const a = await exportRun(result, await mkdtemp(join(tmpdir(), 'poe-dist-')));
  const b = await exportRun(result, await mkdtemp(join(tmpdir(), 'poe-dist-')));
  assert.equal(a.contentHash, b.contentHash);
});

test('schema validation failure fails the run loudly', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'poe-run-'));
  await cp(FIXTURE_RUN, runDir, { recursive: true });
  await mkdir(join(runDir, 'schemas'), { recursive: true });
  // A gem_tags schema that the fixture data (string values) cannot satisfy.
  await writeFile(
    join(runDir, 'schemas', 'gem_tags.json'),
    JSON.stringify({ type: 'object', additionalProperties: { type: 'number' } }),
    'utf8',
  );
  await assert.rejects(() => ingestRun(runDir), /schema validation failed/);
});

test('NFC normalization: decomposed input exports precomposed', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'poe-run-'));
  await mkdir(join(runDir, 'en'), { recursive: true });
  const decomposed = 'Cafe' + '\u0301' + ' Orb'; // e + combining acute, NFD form
  await writeFile(join(runDir, 'en', 'gem_tags.json'), JSON.stringify({ tag: decomposed }), 'utf8');
  const result = await ingestRun(runDir);
  const en = buildLocaleExport(result, 'en');
  assert.equal(en['gem_tags.tag'], 'Caf' + '\u00e9' + ' Orb'); // precomposed NFC form
  assert.equal(en['gem_tags.tag'].length, decomposed.length - 1);
});
