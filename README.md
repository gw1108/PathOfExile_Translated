# PathOfExile_Translated

Translations for **Path of Exile** and **Path of Exile 2** strings, sourced directly from the games' own translation files.

## Goal

Path of Exile ships in many languages, but there is no convenient, machine-readable dictionary that maps a string from one language to another. This project fills that gap.

Rather than hand-writing or machine-translating terms (which produces inaccurate, non-canonical wording), we build translations from the **actual game data**. The result is a set of dictionaries that use the exact wording players see in-game, for every supported language.

Typical uses:

- Localizing third-party tools, trade sites, guides, and overlays.
- Looking up the canonical name of an item, skill, mod, area, or passive in another language.
- Cross-referencing terms between locales.

## How it works

```
RePoE data  ──▶  ingest  ──▶  internal store  ──▶  export  ──▶  dist/<game>/<namespace>/<locale>.json
```

1. **Fetch** — We depend on [RePoE (fork)](https://repoe-fork.github.io/) as our upstream source of extracted, structured game data.
2. **Construct** — We ingest that data into an internal representation that captures each string along with its identity, category, and per-language values.
3. **Export** — We emit that store as simple, consumable per-namespace, per-locale JSON files.

## Output layout

Everything lives under [`dist/poe1/`](./dist/poe1/) and [`dist/poe2/`](./dist/poe2/). Each **namespace** (one kind of string) is a folder holding one JSON file per locale, so you can copy exactly what you need:

```
dist/
  poe1/
    index.json                  release metadata, counts, provenance, anomalies
    full/en.json                EVERY string, keys are "<namespace>.<term_id>"
    full/ja.json
    base_items/en.json          one namespace, keys are bare term ids
    base_items/ja.json
    mods/…  buffs/…  uniques/…  world_areas/…  passives/…  flavour/…
    stat_translations/en.json   the main modifier-template file
    stat_translations/skill/…   per-source-file modifier templates
    …
  poe2/
    (same shape; the poe2-specific namespaces are listed below)
```

- `full/<locale>.json` merges every namespace with `"<namespace>.<term_id>"` keys (split on the **first** dot — namespaces can contain slashes, term ids can contain dots).
- `<namespace>/<locale>.json` holds a single namespace with **bare term ids** as keys.

Locale filenames use [BCP 47](https://www.rfc-editor.org/info/bcp47) codes, one per language Path of Exile ships: `en`, `fr`, `de`, `es`, `pt-BR`, `ru`, `ja`, `ko`, `th`, `zh-Hant`. All files are UTF-8 without a BOM, non-ASCII text is raw (never `\uXXXX`-escaped), values are NFC-normalized with `\n` newlines, and keys are sorted for stable diffs.

For example, `dist/poe2/uniques/ja.json` contains:

```json
{
  "Bramblejack": "ブランブルジャック"
}
```

and the same string appears in `dist/poe2/full/ja.json` as `"uniques.Bramblejack"`.

## Namespaces

Term ids are the game's own internal identifiers, never English text (two documented exceptions below).

| Namespace | Games | Contents | Term id |
|---|---|---|---|
| `base_items` | both | Item base type names | metadata path |
| `base_item_descriptions` | both | Item usage text ("Reforges a rare item…") | metadata path |
| `base_item_directions` | both | Item how-to text ("Right click this item…") | metadata path |
| `gems` | poe1 | Skill/support gem names | gem id |
| `gem_descriptions` | poe1 | Gem description paragraphs | gem id |
| `skill_gems` | poe2 | Skill/support gem names (`active`/`support`/`spirit`) | gem item metadata path |
| `skill_descriptions` | poe2 | Skill description paragraphs | granted-skill id |
| `gem_tags` | both | Gem tag labels | tag id |
| `item_classes` | both | Item class names | class id |
| `essences` | poe1 | Essence names | metadata path |
| `fossils` | poe1 | Fossil names | metadata path |
| `uniques` | both | Unique item names | **English display name** |
| `mods` | both | Mod/affix display names ("of the Brute") | mod id |
| `world_areas` | both | Area/zone names | area id |
| `buffs` | both | Buff/debuff names | buff id |
| `buff_descriptions` | both | Buff/debuff descriptions ("You are Chilled.") | buff id |
| `flavour` | both | Unique item lore text | flavour id |
| `characters` | both | Character class names | metadata path |
| `cost_types` | both | Skill cost labels ("# Mana") | cost id |
| `cluster_jewel_notables` | poe1 | Cluster-jewel notable names | notable id |
| `ascendancies` | poe2 | Ascendancy class names | ascendancy id |
| `ascendancy_flavour` | poe2 | Ascendancy flavour blurbs | ascendancy id |
| `keywords` | poe2 | Hover-keyword terms ("Abandoned City") | keyword id |
| `keyword_definitions` | poe2 | Hover-keyword tooltip text | keyword id |
| `passives` | both | Passive tree node names (keystone/notable/…) | node dat id |
| `stat_translations` | both | Modifier templates ("Allocates # Sinister Jewel sockets") | **stat ids + variant index** |
| `stat_translations/<file>` | both | Modifier templates per source file — `passive_skill` (tree node stat text), `skill` (gem stat lines), `monster`, `atlas`, `advanced_mod`, … (39 files for poe1, 26 for poe2) | **stat ids + variant index** |
| `stat_translations/specific_skill` | poe2 | Per-skill stat text overrides (~450 skills, merged; term ids prefixed `<skill>/`) | **stat ids + variant index** |

**Uniques exception:** upstream exposes no internal id for unique items, so `uniques` is keyed by the English display name (upstream's cross-locale-stable `id` field). Alternate-art duplicates are deduplicated in favor of the non-alternate-art entry.

**stat_translations exception:** modifier text is template data — one stat-id tuple has one or more display variants (positive/negative rolls, singular/plural). Each variant is its own key, `<stat ids joined by space>[<variant index>]`, with numeric placeholders normalized to `#`:

```json
{
  "unique_jewel_grants_x_voices_jewel_sockets[0]": "Allocates # Sinister Jewel sockets",
  "unique_jewel_grants_x_voices_jewel_sockets[1]": "Allocates # Sinister Jewel socket"
}
```

Variant order follows the game's own translation rows, so indexes align across locales; when a locale's variant count differs from English (rare — language-specific plural splits), that locale drops the entry rather than risk pairing the wrong strings, and it's noted in `index.json` anomalies. Roll-range conditions are not exported — consumers needing them should read the upstream files directly.

**Cleanups applied everywhere:** dev placeholder names GGG ships marked "released" but never shows to players (`[DNT] …`, `[UNUSED] …`, `[DO NOT USE] …`) are skipped in every locale, keyed off the English name. Keyword markup (`[Fire]` → `Fire`, `[AoESkill|AoE]` → `AoE`) and render markup (`<size:37>{…}`) are reduced to display text. Terms missing from a locale are **omitted**, never silently filled with English; terms present in a locale but with **no English reference** are dropped (with English empty they are dev filler — localized boilerplate on internal content — not translations). All skips are summarized per file in `index.json` anomalies.

### index.json

Each game's `dist/<game>/index.json` describes the release: per-locale term counts and file hashes, per-namespace counts, per-file fetch provenance (URL, time, SHA-256), key-set differences vs. English, adapter notes, and a `contentHash` over all dictionary content that CI uses to commit only real changes.

## Building locally

Requires Node.js ≥ 22.18 (runs TypeScript natively — no build step).

```bash
npm ci
npm run build          # fetch latest upstream → raw/<run-id>/ → dist/poe1/ + dist/poe2/
npm run export         # rebuild dist/ from the most recent raw run (no fetch)
npm test               # golden-file, adapter, and invariant tests

node src/main.ts --game poe2                    # limit to one game
node src/main.ts --game poe2 --source <path>    # fetch from a local mirror
```

The fetcher writes verbatim upstream snapshots plus a provenance manifest to `raw/<run-id>/<game>/<locale>/` (gitignored; archived by CI). poe1 raw files are validated against the upstream JSON Schemas (`data-formats/`) where available, so upstream format changes fail the build loudly instead of exporting garbage; poe2 publishes no schemas, so it relies on adapter-level checks.

> **poe2 upstream is English-only; localized poe2 data is generated locally.** Both games ship all ten languages in the client, but the RePoE-fork site publishes localized directories (`French/`, `German/`, …) only for poe1 — its poe2 export workflow runs the parser without `-l all`, so only English can be built from published data. The committed `dist/poe2/` locales were generated with the [RePoE parser](https://github.com/repoe-fork/repoe-fork) run locally against GGG's CDN (game version 4.5.4.3), and stay pinned until regenerated the same way — a default `npm run build` only refreshes what upstream publishes. Once upstream adds `-l all` to its poe2 workflow, all locales refresh automatically. The local recipe (requires the PyPoE sibling checkout):
>
> ```bash
> repoe base_items skill_gems gem_tags item_classes uniques stat_translations passives \
>       mods world_areas buffs flavour characters cost_types skills ascendancies keywords \
>       --poe2 -l all -o <mirror>/poe2
> node src/main.ts --game poe2 --source <mirror>
> ```

## Scope

Everything RePoE exports with player-facing display strings is included: items, gems, tags, classes, essences, fossils, uniques, mods, areas, buffs, flavour text, classes/ascendancies, keywords, passive tree nodes, and all modifier-template files. Not available from this upstream (and therefore not here): quest text, NPC dialogue, and UI chrome strings — those aren't in RePoE's export at all.

## Data source & credits

All game text originates from Path of Exile and is made available in structured form by the [RePoE fork](https://repoe-fork.github.io/) project. This repository is not affiliated with or endorsed by Grinding Gear Games.

## License

Released under the [MIT License](./LICENSE). Path of Exile and all related terms are trademarks of Grinding Gear Games.
