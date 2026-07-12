# PathOfExile_Translated

Translations for common **Path of Exile** (and **Path of Exile 2**) terms, sourced directly from the games' own translation files.

## Goal

Path of Exile ships in many languages, but there is no convenient, machine-readable dictionary that maps a term from one language to another. This project fills that gap.

Rather than hand-writing or machine-translating terms (which produces inaccurate, non-canonical wording), we build translations from the **actual game data**. The result is a set of dictionaries that use the exact terminology players see in-game, for every supported language.

Typical uses:

- Localizing third-party tools, trade sites, guides, and overlays.
- Looking up the canonical name of an item, skill, mod, or currency in another language.
- Cross-referencing terms between locales.

## How it works

```
RePoE data  ──▶  ingest  ──▶  internal store  ──▶  export  ──▶  en.json, es.json, ...
```

1. **Fetch** — We depend on [RePoE (fork)](https://repoe-fork.github.io/) as our upstream source of extracted, structured game data.
2. **Construct** — We ingest that data into an internal representation that captures each term along with its identity, category, and per-language values.
3. **Export** — We emit that store into simple, consumable formats — one file per locale, e.g. `en.json`.

## Output format

Exports live in [`dist/poe1/`](./dist/poe1/) and [`dist/poe2/`](./dist/poe2/) as per-locale JSON files that map a stable key to its localized string. Filenames use [BCP 47](https://www.rfc-editor.org/info/bcp47) language codes — one per locale that Path of Exile ships:

| File           | Language            |
|----------------|---------------------|
| `en.json`      | English             |
| `fr.json`      | French              |
| `de.json`      | German              |
| `es.json`      | Spanish             |
| `pt-BR.json`   | Portuguese          |
| `ru.json`      | Russian             |
| `ja.json`      | Japanese            |
| `ko.json`      | Korean              |
| `th.json`      | Thai                |
| `zh-Hant.json` | Traditional Chinese |

Codes carry a region or script subtag only where the source data distinguishes one (`pt-BR`, `zh-Hant`); everything else is a plain language code. All files are UTF-8 without a BOM, non-ASCII text is emitted raw (never `\uXXXX`-escaped), values are normalized to Unicode NFC, and keys are sorted for stable diffs.

> **poe2 upstream is English-only; localized poe2 data is generated locally.** Both games ship all ten languages in the client, but the RePoE-fork site publishes localized directories (`French/`, `German/`, …) only for poe1 — its poe2 export workflow runs the parser without `-l all`, so only `dist/poe2/en.json` can be built from published data. The committed `dist/poe2/` locales were instead generated with the RePoE parser run locally against GGG's CDN (game version 4.5.4.3; see "Building locally"), and stay pinned until regenerated the same way — a default `npm run build` only refreshes what upstream publishes. Once upstream adds `-l all` to its poe2 workflow, all locales refresh automatically.

### Key schema

Every key is `"<namespace>.<term_id>"`, split on the **first** dot (term ids may themselves contain dots or slashes). The `term_id` is the game's own internal identifier, never English text:

| Namespace      | Game       | Term id                                    | Example key |
|----------------|------------|--------------------------------------------|-------------|
| `base_items`   | poe1, poe2 | metadata path                              | `base_items.Metadata/Items/Currency/CurrencyRerollRare` |
| `gems`         | poe1       | gem id                                     | `gems.Fireball` |
| `skill_gems`   | poe2       | gem item metadata path                     | `skill_gems.Metadata/Items/Gem/SkillGemFireball` |
| `gem_tags`     | poe1, poe2 | tag id                                     | `gem_tags.fire` |
| `item_classes` | poe1, poe2 | class id                                   | `item_classes.LifeFlask` |
| `essences`     | poe1       | essence item metadata path                 | `essences.Metadata/Items/Currency/CurrencyEssenceHatred1` |
| `fossils`      | poe1       | fossil item metadata path                  | `fossils.Metadata/Items/Currency/CurrencyDelveCraftingFire` |
| `uniques`      | poe1, poe2 | English display name (documented exception)| `uniques.Redbeak` |

The per-game file sets differ upstream: poe2 has no `gems.json` (its gem data lives in `skill_gems.json`, keyed by item metadata path with a `gem_type` of `active`/`support`/`spirit` as the category) and ships no essences or fossils files.

**Uniques exception:** upstream exposes no internal id for unique items, so the `uniques` namespace is keyed by the English display name (upstream's cross-locale-stable `id` field). Alternate-art duplicates are deduplicated in favor of the non-alternate-art entry.

**Cleanups applied to both games:** dev placeholder names GGG ships marked "released" but never shows to players (`[DNT] …`, `[UNUSED] …`, `[DO NOT USE] …`) are skipped — in every locale, keyed off the English name, since localized files often carry a real-looking translation for these dev-only items. poe2 keyword markup in `gem_tags` values (`[Fire]` → `Fire`, `[AoESkill|AoE]` → `AoE`) and render markup in localized names (`<size:37>{…}` in poe2 Thai) are reduced to their display text. All are summarized per file in `index.json` anomalies.

For example, `dist/poe1/ja.json` contains:

```json
{
  "base_items.Metadata/Items/Currency/CurrencyRerollRare": "カオスオーブ",
  "gem_tags.fire": "火",
  "uniques.Redbeak": "レッドビーク"
}
```

Terms missing from a locale (upstream language directories can lag the English export) are **omitted**, never silently filled with English.

### index.json

Each game's `dist/<game>/index.json` describes the release: per-locale term counts and file hashes, per-file fetch provenance (URL, time, SHA-256), key-set differences vs. English, adapter notes, and a `contentHash` over all dictionary content that CI uses to commit only real changes.

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

The fetcher writes verbatim upstream snapshots plus a provenance manifest to `raw/<run-id>/<game>/<locale>/` (gitignored; archived by CI). Each poe1 raw file is validated against the upstream JSON Schemas (`data-formats/`) during ingest, so upstream format changes fail the build loudly instead of exporting garbage; poe2 publishes no schemas, so it relies on adapter-level checks. A scheduled GitHub Action refreshes `dist/` daily, committing only when the dictionary content actually changed.

To build localized poe2 dictionaries before upstream publishes them, generate a mirror with the [RePoE parser](https://github.com/repoe-fork/repoe-fork) (it streams game data from GGG's CDN; requires its PyPoE sibling checkout):

```bash
repoe base_items skill_gems gem_tags item_classes uniques --poe2 -l all -o <mirror>/poe2
node src/main.ts --game poe2 --source <mirror>
```

Current scope is flat term dictionaries (items, skills, tags, classes, essences, fossils, uniques). Modifier text (`stat_translations`) is conditional-template data, not flat strings, and is planned as a later phase.

## Data source & credits

All game terminology originates from Path of Exile and is made available in structured form by the [RePoE fork](https://repoe-fork.github.io/) project. This repository is not affiliated with or endorsed by Grinding Gear Games.

## License

Released under the [MIT License](./LICENSE). Path of Exile and all related terms are trademarks of Grinding Gear Games.
