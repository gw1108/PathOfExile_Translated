import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADAPTERS, baseItems, gemTags, gems, uniques } from '../src/adapters.ts';
import { NAMESPACES } from '../src/config.ts';

test('every configured namespace has an adapter', () => {
  for (const ns of NAMESPACES) {
    assert.equal(typeof ADAPTERS[ns.namespace], 'function', `missing adapter for ${ns.namespace}`);
  }
});

test('gem_tags: null display text is skipped silently, not an anomaly', () => {
  const { terms, anomalies } = gemTags({ fire: 'Fire', strength: null, cold: 'Cold' });
  assert.deepEqual(
    terms.map((t) => t.id).sort(),
    ['cold', 'fire'],
  );
  assert.deepEqual(anomalies, []);
});

test('gems: active gems use active_skill.display_name, supports use base_item.display_name', () => {
  const { terms, anomalies } = gems({
    Fireball: { active_skill: { display_name: 'Fireball' }, base_item: { display_name: 'Fireball gem item' } },
    SupportAddedFire: { active_skill: null, base_item: { display_name: 'Added Fire Damage Support' } },
    ModOnlyEffect: { active_skill: null, base_item: null },
  });
  assert.deepEqual(
    Object.fromEntries(terms.map((t) => [t.id, t.text])),
    { Fireball: 'Fireball', SupportAddedFire: 'Added Fire Damage Support' },
  );
  // Mod-only effects are skipped by design and summarized, never per-entry noise.
  assert.equal(anomalies.length, 1);
  assert.match(anomalies[0], /skipped 1 entries/);
});

test('base_items: unreleased entries and empty names are skipped and summarized', () => {
  const { terms, anomalies } = baseItems({
    'Metadata/Items/A': { name: 'Thing', item_class: 'Amulet', release_state: 'released' },
    'Metadata/Items/B': { name: 'Secret', item_class: 'Amulet', release_state: 'unreleased' },
    'Metadata/Items/C': { name: '', item_class: 'Amulet', release_state: 'released' },
  });
  assert.deepEqual(terms.map((t) => t.id), ['Metadata/Items/A']);
  assert.equal(terms[0].category, 'Amulet');
  assert.equal(anomalies.length, 2);
});

test('uniques: keyed by English-name id, alternate art deduplicated toward non-alt entry', () => {
  const { terms, anomalies } = uniques({
    '0': { id: 'Redbeak', name: 'Pico rojo', is_alternate_art: true, item_class: 'Sword' },
    '1': { id: 'Redbeak', name: 'Pico rojo', is_alternate_art: false, item_class: 'Sword' },
    '2': { id: "Kaom's Primacy", name: 'Primacía de Kaom', is_alternate_art: false, item_class: 'Axe' },
  });
  assert.equal(terms.length, 2);
  const redbeak = terms.find((t) => t.id === 'Redbeak');
  assert.ok(redbeak);
  assert.equal(redbeak.text, 'Pico rojo');
  assert.ok(anomalies.some((a) => /deduplicated 1/.test(a)));
});

test('adapters reject a non-object top level', () => {
  assert.throws(() => gemTags([1, 2, 3]), /expected a JSON object/);
});
