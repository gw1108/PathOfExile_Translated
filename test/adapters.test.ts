import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADAPTERS,
  baseItems,
  gemTags,
  gems,
  isPlaceholderName,
  skillGems,
  stripMarkup,
  uniques,
} from '../src/adapters.ts';
import { GAMES } from '../src/config.ts';

test('every configured namespace of every game has an adapter', () => {
  for (const game of GAMES) {
    for (const ns of game.namespaces) {
      assert.equal(typeof ADAPTERS[ns.namespace], 'function', `missing adapter for ${game.game}/${ns.namespace}`);
    }
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

test('gem_tags: poe2 keyword markup is reduced to display text', () => {
  const { terms, anomalies } = gemTags({
    fire: '[Fire]',
    area: '[AoESkill|AoE]',
    support: '[SupportGem|Support]',
    plain: 'Plain',
  });
  assert.deepEqual(
    Object.fromEntries(terms.map((t) => [t.id, t.text])),
    { fire: 'Fire', area: 'AoE', support: 'Support', plain: 'Plain' },
  );
  assert.ok(anomalies.some((a) => /stripped keyword markup from 3 values/.test(a)));
});

test('stripMarkup: [X] renders X, [X|Y] renders Y, plain text untouched', () => {
  assert.equal(stripMarkup('[Fire]'), 'Fire');
  assert.equal(stripMarkup('[AoESkill|AoE]'), 'AoE');
  assert.equal(stripMarkup('no markup'), 'no markup');
  assert.equal(stripMarkup('[Chain|Chaining] and [Cold]'), 'Chaining and Cold');
});

test('isPlaceholderName matches every dev-placeholder style upstream ships', () => {
  for (const name of [
    '[DNT] Call of the Wild',
    '[DNT-UNUSED] Axe Chop',
    '[DNT - UNUSED] Test Runegraft',
    '[UNUSED] Conflagration Support',
    '[DO NOT USE] Urn Relic',
  ]) {
    assert.ok(isPlaceholderName(name), `should match: ${name}`);
  }
  assert.ok(!isPlaceholderName('Chaos Orb'));
  assert.ok(!isPlaceholderName('[Fire]')); // keyword markup, not a placeholder
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

test('gems: dev-placeholder names are skipped, summarized, and reported by id', () => {
  const { terms, anomalies, placeholderIds } = gems({
    Real: { active_skill: { display_name: 'Fireball' } },
    Junk: { active_skill: { display_name: '[UNUSED] Blood Whirl' } },
  });
  assert.deepEqual(terms.map((t) => t.id), ['Real']);
  assert.ok(anomalies.some((a) => /dev-placeholder/.test(a)));
  assert.deepEqual(placeholderIds, ['Junk']);
});

test('skill_gems (poe2): named by base_item.display_name, categorized by gem_type', () => {
  const { terms, anomalies } = skillGems({
    'Metadata/Items/Gem/SkillGemFireball': {
      base_item: { display_name: 'Fireball', release_state: 'released' },
      gem_type: 'active',
    },
    'Metadata/Items/Gems/SupportGemMartialTempo': {
      base_item: { display_name: 'Martial Tempo', release_state: 'released' },
      gem_type: 'support',
    },
    'Metadata/Items/Gem/SkillGemHerald': {
      base_item: { display_name: 'Herald of Thunder', release_state: 'released' },
      gem_type: 'spirit',
    },
    'Metadata/Items/Gem/Unreleased': {
      base_item: { display_name: 'Secret', release_state: 'unreleased' },
      gem_type: 'active',
    },
    'Metadata/Items/Gem/NoBaseItem': { base_item: null, gem_type: 'active' },
    'Metadata/Items/Gem/DevJunk': {
      base_item: { display_name: '[DNT-UNUSED] Axe Chop', release_state: 'released' },
      gem_type: 'active',
    },
  });
  assert.deepEqual(
    Object.fromEntries(terms.map((t) => [t.id, t.text])),
    {
      'Metadata/Items/Gem/SkillGemFireball': 'Fireball',
      'Metadata/Items/Gems/SupportGemMartialTempo': 'Martial Tempo',
      'Metadata/Items/Gem/SkillGemHerald': 'Herald of Thunder',
    },
  );
  assert.equal(terms.find((t) => t.id === 'Metadata/Items/Gem/SkillGemHerald')?.category, 'spirit');
  assert.ok(anomalies.some((a) => /skipped 1 unreleased/.test(a)));
  assert.ok(anomalies.some((a) => /skipped 1 entries with no display name/.test(a)));
  assert.ok(anomalies.some((a) => /dev-placeholder/.test(a)));
});

test('base_items: unreleased entries, empty names, and placeholders are skipped and summarized', () => {
  const { terms, anomalies } = baseItems({
    'Metadata/Items/A': { name: 'Thing', item_class: 'Amulet', release_state: 'released' },
    'Metadata/Items/B': { name: 'Secret', item_class: 'Amulet', release_state: 'unreleased' },
    'Metadata/Items/C': { name: '', item_class: 'Amulet', release_state: 'released' },
    'Metadata/Items/D': { name: '[DNT] Not Shown To Players', item_class: 'Amulet', release_state: 'released' },
  });
  assert.deepEqual(terms.map((t) => t.id), ['Metadata/Items/A']);
  assert.equal(terms[0].category, 'Amulet');
  assert.equal(anomalies.length, 3);
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
