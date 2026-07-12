import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADAPTERS,
  baseItems,
  gemTags,
  gems,
  isPlaceholderName,
  passiveNodes,
  skillGems,
  statTranslations,
  stripMarkup,
  stripRenderMarkup,
  uniques,
} from '../src/adapters.ts';
import { GAMES } from '../src/config.ts';

test('every configured namespace of every game has an adapter', () => {
  for (const game of GAMES) {
    for (const ns of game.namespaces) {
      const key = ns.adapter ?? ns.namespace;
      assert.equal(typeof ADAPTERS[key], 'function', `missing adapter "${key}" for ${game.game}/${ns.namespace}`);
    }
  }
});

test('mods: only named mods export, categorized by generation_type', () => {
  const { terms } = ADAPTERS.mods({
    Strength1: { name: 'of the Brute', generation_type: 'suffix' },
    InternalOnly: { name: '', generation_type: 'suffix' },
    Junk: { name: '[DNT] test mod', generation_type: 'prefix' },
  });
  assert.deepEqual(terms, [{ id: 'Strength1', text: 'of the Brute', category: 'suffix' }]);
});

test('buffs file feeds two namespaces: names and descriptions', () => {
  const data = {
    chilled: { name: 'Chill', description: 'You are Chilled.', category: 'Debuff' },
    hidden_buff: { name: '', description: 'Internal.' },
  };
  assert.deepEqual(ADAPTERS.buffs(data).terms, [{ id: 'chilled', text: 'Chill', category: 'Debuff' }]);
  assert.deepEqual(
    ADAPTERS.buff_descriptions(data).terms,
    [
      { id: 'chilled', text: 'You are Chilled.', category: undefined },
      { id: 'hidden_buff', text: 'Internal.', category: undefined },
    ],
  );
});

test('keywords: term and definition namespaces, placeholder-guarded by term', () => {
  const data = {
    AbandonedCityMap: { term: 'Abandoned City', definition: 'Cities have few inhabitants.' },
    AbsentAmulet: { term: '', definition: '' },
  };
  assert.deepEqual(ADAPTERS.keywords(data).terms.map((t) => t.text), ['Abandoned City']);
  assert.deepEqual(ADAPTERS.keyword_definitions(data).terms.map((t) => t.id), ['AbandonedCityMap']);
});

test('cost_types: format placeholders normalize to #', () => {
  const { terms } = ADAPTERS.cost_types({ Mana: { format_text: '{0} Mana' }, NoText: {} });
  assert.deepEqual(terms, [{ id: 'Mana', text: '# Mana', category: undefined }]);
});

test('characters: array keyed by metadata_id', () => {
  const { terms } = ADAPTERS.characters([
    { metadata_id: 'Metadata/Characters/Str/Str', name: 'Marauder' },
    { metadata_id: '', name: 'Nameless' },
  ]);
  assert.deepEqual(terms, [{ id: 'Metadata/Characters/Str/Str', text: 'Marauder' }]);
});

test('base_item help text: description/directions namespaces guarded by item name', () => {
  const data = {
    'Metadata/Items/Currency/CurrencyRerollRare': {
      name: 'Chaos Orb',
      properties: { description: 'Reforges a rare item.', directions: 'Right click this item.' },
    },
    'Metadata/Items/Currency/Junk': {
      name: '[DNT] Not Shown To Players',
      properties: { description: 'Secret.', directions: 'Secret.' },
    },
  };
  assert.deepEqual(ADAPTERS.base_item_descriptions(data).terms.map((t) => t.text), ['Reforges a rare item.']);
  assert.deepEqual(ADAPTERS.base_item_directions(data).terms.map((t) => t.text), ['Right click this item.']);
  assert.deepEqual(ADAPTERS.base_item_descriptions(data).placeholderIds, ['Metadata/Items/Currency/Junk']);
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

test('stat_translations: variants become indexed terms with # placeholders, markup stripped', () => {
  const { terms, anomalies } = statTranslations([
    {
      English: [
        { string: 'Allocates {0} [SinisterJewelSockets|Sinister] [Jewel] sockets' },
        { string: '{0:+d}% to [Resistances|all Resistances]' },
      ],
      ids: ['unique_jewel_grants_x_voices_jewel_sockets'],
      trade_stats: null,
    },
    { English: [{ string: 'Never shown' }], ids: ['custom_stat'], hidden: true },
    { English: [{ string: '' }, { string: '{0}' }], ids: ['blank_stat'] },
    { English: [{ string: 'Two-id line {0} and {1}' }], ids: ['stat_a', 'stat_b'] },
  ]);
  assert.deepEqual(
    Object.fromEntries(terms.map((t) => [t.id, t.text])),
    {
      'unique_jewel_grants_x_voices_jewel_sockets[0]': 'Allocates # Sinister Jewel sockets',
      'unique_jewel_grants_x_voices_jewel_sockets[1]': '#% to all Resistances',
      'stat_a stat_b[0]': 'Two-id line # and #',
    },
  );
  assert.ok(anomalies.some((a) => /skipped 1 hidden/.test(a)));
  assert.ok(anomalies.some((a) => /skipped 2 empty/.test(a)));
});

test('stat_translations: language key is discovered dynamically (localized files)', () => {
  const { terms } = statTranslations([
    { French: [{ string: 'Orbe {0}' }], ids: ['some_stat'] },
  ]);
  assert.deepEqual(terms, [{ id: 'some_stat[0]', text: 'Orbe #' }]);
});

test('stat_translations rejects a non-array top level', () => {
  assert.throws(() => statTranslations({}), /expected a JSON array/);
});

test('passives: named nodes keyed by dat id, icon-only and unnamed skipped, categorized', () => {
  const { terms, anomalies } = passiveNodes({
    title: 'PassiveSkillTreeTitle',
    passives: {
      '59636': { id: 'mana_regeneration22_', name: 'Open Mind', is_notable: true, is_icon_only: false },
      '10': { id: 'chaos_inoculation', name: 'Chaos Inoculation', is_keystone: true, is_icon_only: false },
      '11': { id: 'jewel_socket_1', name: 'Jewel Socket', is_jewel_socket: true, is_icon_only: false },
      '12': { id: 'asc_node', name: 'Blood Magus', ascendancy: 'BloodMage', is_icon_only: false },
      '13': { id: 'deco', name: '', is_icon_only: true },
      '14': { id: 'unnamed_small', name: '', is_icon_only: false },
    },
  });
  assert.deepEqual(
    Object.fromEntries(terms.map((t) => [t.id, t.category])),
    {
      mana_regeneration22_: 'notable',
      chaos_inoculation: 'keystone',
      jewel_socket_1: 'jewel_socket',
      asc_node: 'ascendancy',
    },
  );
  assert.ok(anomalies.some((a) => /skipped 1 unnamed/.test(a)));
});

test('stripRenderMarkup unwraps size and nested tag markup, leaves placeholders alone', () => {
  assert.equal(stripRenderMarkup('<size:37>{ระเบิด}'), 'ระเบิด');
  assert.equal(stripRenderMarkup('<italic>{<white>{X}}'), 'X');
  assert.equal(stripRenderMarkup('Spectre: {0}'), 'Spectre: {0}');
  // Malformed game markup: fullwidth/wrong/missing closing brace.
  assert.equal(stripRenderMarkup('<size:30>{味わうがいい。｝'), '味わうがいい。');
  assert.equal(stripRenderMarkup('前文\n<size:29>{已汙染)'), '前文\n已汙染');
  assert.equal(stripRenderMarkup('<size:27>{Corrompido'), 'Corrompido');
});

test('adapters reject a non-object top level', () => {
  assert.throws(() => gemTags([1, 2, 3]), /expected a JSON object/);
});
