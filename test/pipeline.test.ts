import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gameConfig } from '../src/config.ts';
import { buildLocaleExport, exportRun } from '../src/export.ts';
import { ingestRun } from '../src/ingest.ts';

const FIXTURE_RUN = join(import.meta.dirname, 'fixtures', 'run');
const FIXTURE_RUN_POE2 = join(import.meta.dirname, 'fixtures', 'run-poe2');

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

test('poe2 golden: game-subdir run ingests markup-stripped, placeholder-free dictionaries', async () => {
  const result = await ingestRun(FIXTURE_RUN_POE2, gameConfig('poe2'));

  assert.deepEqual(buildLocaleExport(result, 'en'), {
    'base_items.Metadata/Items/Currency/CurrencyRerollRare': 'Chaos Orb',
    'gem_tags.area': 'AoE',
    'gem_tags.fire': 'Fire',
    'item_classes.LifeFlask': 'Life Flasks',
    'skill_gems.Metadata/Items/Gem/SkillGemFireball': 'Fireball',
    'skill_gems.Metadata/Items/Gems/SupportGemMartialTempo': 'Martial Tempo',
    'uniques.Bramblejack': 'Bramblejack',
  });
  assert.deepEqual(buildLocaleExport(result, 'ja'), {
    'base_items.Metadata/Items/Currency/CurrencyRerollRare': 'カオスオーブ',
    'gem_tags.area': '範囲',
    'gem_tags.fire': '火',
    'item_classes.LifeFlask': 'ライフフラスコ',
    'skill_gems.Metadata/Items/Gem/SkillGemFireball': 'ファイアボール',
    'skill_gems.Metadata/Items/Gems/SupportGemMartialTempo': 'マーシャルテンポ',
    'uniques.Bramblejack': 'ブランブルジャック',
  });
  // No JSON Schemas exist for poe2 — noted once, not per namespace.
  assert.ok(result.report.schemaNotes.some((n) => n.includes('poe2')));

  // An id whose ENGLISH name is a dev placeholder is suppressed in every
  // locale, even when the locale carries a real-looking translation for it.
  assert.ok(!('base_items.Metadata/Items/Currency/CurrencyIncursionWeaponOrArmourQualityLow' in buildLocaleExport(result, 'ja')));
  const jaDetail = result.report.details.find((d) => d.locale === 'ja' && d.namespace === 'base_items');
  assert.ok(jaDetail?.notes.some((n) => /suppressed 1 entries whose English name is a dev placeholder/.test(n)));

  // Thai render markup (<size:N>{...}) is stripped to its display text.
  assert.equal(buildLocaleExport(result, 'th')['base_items.Metadata/Items/Currency/CurrencyRerollRare'], 'คาออสออร์บ');
  const thDetail = result.report.details.find((d) => d.locale === 'th' && d.namespace === 'base_items');
  assert.ok(thDetail?.notes.some((n) => /stripped render markup/.test(n)));
});

test('poe2 export: dist/poe2 with game-scoped index.json and provenance', async () => {
  const result = await ingestRun(FIXTURE_RUN_POE2, gameConfig('poe2'));
  const distRoot = await mkdtemp(join(tmpdir(), 'poe-dist-'));
  const summary = await exportRun(result, distRoot);

  assert.deepEqual(summary.localeCounts, { en: 7, ja: 7, th: 1 });
  const index = JSON.parse(await readFile(join(distRoot, 'poe2', 'index.json'), 'utf8'));
  assert.equal(index.game, 'poe2');
  assert.equal(index.runId, 'fixture-run-poe2');
  assert.deepEqual(Object.keys(index.namespaces).sort(), ['base_items', 'gem_tags', 'item_classes', 'skill_gems', 'uniques']);
  assert.equal(index.locales.ja.fetched[0].sha256, 'dddd');
  // Placeholder junk is summarized in anomalies, not exported.
  assert.ok(index.anomalies.some((a: { notes: string[] }) => a.notes.some((n) => n.includes('dev-placeholder'))));
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
