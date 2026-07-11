# PathOfExile_Translated — Implementation Plan

## Overview

Build a PoE1 pipeline that ingests RePoE-fork data, builds an in-memory term map, and exports per-locale dictionary files (`en.json`, `es.json`, …) mapping stable keys to canonical in-game strings.

```
RePoE data ──▶ ingest ──▶ in-memory term map ──▶ export ──▶ per-locale JSON
```

## Upstream facts that shape the design

- RePoE-fork hosts English data at the root of `https://repoe-fork.github.io/` and localized data in per-language directories: `French/`, `German/`, `Japanese/`, `Korean/`, `Portuguese/`, `Russian/`, `Spanish/`, `Thai/`, `Traditional Chinese/`, each mirroring the same file set (e.g. `Spanish/base_items.json`).
- JSON Schemas for each file live under `data-formats/` — use them to validate ingest and detect upstream format changes.
- `.min.json` variants exist for the Phase-1 files; fetch those to cut bandwidth.
- `stat_translations` are NOT flat strings — they are conditional templates (stat ids + value ranges + format handlers). Everything else relevant (base items, gems, gem tags, essences, fossils, item classes, uniques) is effectively flat name data. Note `tags.json` is a list of tag *identifiers* with no localized display text, so it is not a translation source — `gem_tags.json` (an id→display-string map) is.
- Locale directories can lag the root export and each other. Do not assume a single upstream game version or identical ID sets across locales.

## Scope decision (Phase 1)

Start with **flat term dictionaries only**: canonical names for items, skills, currencies, and related categories. Modifier text is explicitly out of Phase 1: RePoE represents it through conditional `stat_translations` templates, not a flat mod-name field. It remains a later project phase so the README's broader goal is not silently dropped.

Phase 1 namespaces:

| Namespace     | Source file           | Key source                        |
|---------------|-----------------------|-----------------------------------|
| `base_items`  | base_items.json       | metadata id (`Metadata/Items/...`)|
| `gems`        | gems.json             | gem id                            |
| `gem_tags`    | gem_tags.json         | tag id                            |
| `item_classes`| item_classes.json     | class id                          |
| `essences`    | essences.json         | essence item id                   |
| `fossils`     | fossils.json          | fossil item id                    |
| `uniques`     | uniques.json          | `id` field (documented exception — see below) |

**Uniques keying exception:** `uniques.json` is keyed by positional numeric index (fragile across exports) and carries no internal metadata id. The only cross-locale-stable identifier is the `id` field — which is the English display name, appearing verbatim in localized files while `name` holds the translation. Key uniques by `id` as a documented exception to the term-identity rule; never use the numeric index. Entries can share an `id` when `is_alternate_art` is true — deduplicate by preferring the non-alternate-art entry.

## Architecture

Three decoupled stages, each independently runnable and testable:

### 1. Fetcher (`fetch/`)
- Downloads the needed `.min.json` files for every language directory + root (English).
- Writes verbatim inputs to `raw/<run-id>/<locale>/<file>.json`, where `<run-id>` is a UTC timestamp or content-derived identifier.
- Records a manifest per run: fetch time, resolved URL, and content hash for each locale/file. This is the provenance record — we always fetch the latest translations upstream exposes and do not track or promise historical game versions.
- For the first release, always fetch the small Phase-1 set. Add conditional requests only if routine runs make the optimization worthwhile.

### 2. Ingest / Construct (`ingest/`)
- Validates each raw file against its JSON Schema from `data-formats/`, provided the schema accepts the `.min.json` form; otherwise validate the full variant or retain focused runtime checks for the fields consumed.
- Normalizes into the internal store keyed by `(game, namespace, term_id, locale)`.
- **Term identity rule:** always the game's own internal id (metadata path, stat id, tag id). Never English text, never invented keys. Sole documented exception: `uniques`, keyed by its English-name `id` field (see Scope decision).
- Uses a small, tested adapter per namespace to extract its ID, display text, and optional metadata. Do not assume every source uses an object with a `name` field: `gem_tags` is an ID-to-string map whose values can be `null` for tags with no display text (e.g. `strength`) — skip those, don't report them as empty-string anomalies; `gems` keeps its localized name in `active_skill.display_name` (active gems) or `base_item.display_name` (supports), and entries with neither (mod-only effects with `base_item: null`) are skipped.
- Records per-term metadata: namespace, category/tags where available, source run id.
- Reports anomalies: IDs missing from or extra to English, duplicate IDs, empty strings, and coverage skew between locales (a locale directory that lags the latest root export). Never substitutes English text into another locale.

### 3. Exporter (`export/`)
- Emits `dist/poe1/<locale>.json` — flat `{ "namespace.term_id": "localized string" }`. This is the Phase-1 public contract.
- Also emits `dist/poe1/index.json`: locales available, term counts, per-locale fetch time and content hash, missing/extra ID counts, and generation time.
- Document the final key schema in the README when the exporter lands. Defer combined and reverse lookup artifacts until a consumer needs them.

## Internal representation

The whole dataset is on the order of ~10k distinct terms per locale (tens of thousands of short strings across all locales) — it fits comfortably in memory. No database. The internal store is an in-memory map built during ingest and thrown away after export; the durable artifacts are the raw snapshots (input) and the `dist/` JSON (output).

Shape:

```
Map<termKey, {
  namespace: string,          // 'base_items', 'gems', ...
  category?: string,          // item_class / tags summary, optional
  values: Map<locale, string> // 'en' → 'Chaos Orb', 'es' → 'Orbe del Caos', ...
}>
```

where `termKey = "poe1|<namespace>|<term_id>"` and `term_id` is the upstream object's stable internal key (metadata path, tag id, or other documented object key).

Building it is a pivot: for each locale file, its namespace adapter extracts the ID and display string, then writes `values[locale] = displayString`. The implementation validates each namespace's key strategy and records key-set differences; it does not assume locale files are identical. Export then walks the map once per locale.

### Locale set (source of truth: what actually exists upstream)

Verified against `https://repoe-fork.github.io/` — English lives at the root; these nine localized directories exist, each mirroring the English file set:

| Upstream dir          | BCP 47 code |
|-----------------------|-------------|
| (root)                | `en`        |
| `French`              | `fr`        |
| `German`              | `de`        |
| `Spanish`             | `es`        |
| `Portuguese`          | `pt-BR`     |
| `Russian`             | `ru`        |
| `Japanese`            | `ja`        |
| `Korean`              | `ko`        |
| `Thai`                | `th`        |
| `Traditional Chinese` | `zh-Hant`   |

Ten locales total. There is **no** Simplified Chinese, no separate Latin-American Spanish, and no other language directory upstream — do not invent codes for locales the source doesn't ship. Keep this mapping in one constant; treat the directory names (with the space in `Traditional Chinese`, URL-encoded as `%20`) as the upstream keys.

**Filename decision:** export `<locale>.json` using the BCP 47 code — `en.json`, `es.json`, `pt-BR.json`, `zh-Hant.json`. This already matches the README. The source distinguishes only language (+ script for Chinese), never region beyond `pt-BR`, so `es_ES`/`en_US` region tags would be fabricated precision.

### Text encoding — UTF-8 handles CJK fully

Yes. UTF-8 encodes the entire Unicode range, so Japanese, Korean, Traditional Chinese, Thai, Cyrillic, and accented Latin all round-trip losslessly — this is the standard and only sane choice for JSON (RFC 8259 mandates UTF-8 for interchange). Two concrete rules to avoid subtle breakage:

- **Do not `\uXXXX`-escape non-ASCII on output.** It's valid JSON but bloats CJK files ~3× and hurts readability. Emit raw UTF-8 (`ensure_ascii=false` in Python; default in `JSON.stringify`). Write files as UTF-8 **without a BOM**.
- **Normalize to Unicode NFC** on ingest so identical-looking strings compare equal (matters for future reverse lookup and for any consumer doing string equality). Upstream is almost certainly already NFC, but normalizing is cheap insurance.

## Deferred reverse lookup

Do not ship a reverse index in Phase 1. Localized strings are not unique: collisions can occur within or across namespaces and differ by locale. If a consumer needs reverse lookup later, use a lossless `localized string → term-id[]` schema, optionally namespace-scoped; never choose one colliding ID and silently discard the rest.

## Tech stack recommendation

- **Language:** TypeScript (Node) or Python — both fine.
- **Types:** hand-write the small interfaces for the handful of fields we actually read (the id key; `name`, or for gems `active_skill.display_name`/`base_item.display_name`; `item_class`/`release_state`/`tags` for filtering). We touch ~4 fields per file, so codegen (quicktype) isn't worth the toolchain — a dozen lines of hand-written types are faster to write and read. Keep runtime schema *validation* against `data-formats/` (that's the real upstream-change tripwire); it's independent of whether types are generated.
- **Storage:** none. In-memory pivot (see "Internal representation"); the only files on disk are raw snapshots and `dist/` JSON.
- **CI/CD:** GitHub Actions
  - A scheduled workflow (e.g. daily) runs fetch → ingest → export and commits changed `dist/` and its manifest to the repository.
  - A PR workflow runs validation and tests. Publishing through Pages or releases is explicitly deferred.

## Milestones

1. **M0 – Skeleton (½ day):** repo layout, config (list of files/langs/games), fetcher with snapshot manifest.
2. **M1 – English-only end-to-end (1 day):** ingest `base_items` + `gem_tags` for English, export `en.json`. Proves the pipeline shape.
3. **M2 – All locales, all Phase-1 namespaces (1–2 days):** locale mapping, key-difference reporting, per-locale fetch provenance (time + content hash), and `index.json`.
4. **M3 – Automation (½ day):** scheduled GitHub Action that commits generated changes only when content hashes differ.
5. **Later – Modifier translations:** ingest `stat_translations/` per language while preserving conditions, formats, and handlers. Write a separate design before choosing whether to export raw templates or a resolved-line API.
6. **Later – PoE2:** assess its distinct schema and locale availability as a separate project increment; do not put it in the PoE1 Phase-1 delivery.

## Testing

- Golden-file tests: tiny fixture copies of upstream JSON → assert exact export output.
- Schema validation tests against `data-formats/`.
- Invariant tests: every valid source term appears in its locale export; no empty values; differences from English are listed in `index.json`; no locale receives substituted English text.
- Snapshot diff report between two runs (added/removed/changed terms) — doubles as release notes.

## Risks & mitigations

- **Upstream format changes** (explicitly warned by RePoE): schema validation fails loudly in CI rather than exporting garbage; pin last-good snapshot.
- **Upstream availability:** raw snapshots are committed/archived, so exports can always be rebuilt without upstream.
- **Locale coverage gaps:** locale directories can lag the latest root export; record per-locale fetch provenance and anomaly reports, and omit unavailable terms rather than substituting English silently.
- **Licensing:** string content belongs to GGG; MIT covers only the tooling. Keep the credit/disclaimer in README and in `index.json` metadata.

## Definition of done (Phase 1)

- The project's documented build command produces `dist/poe1/<locale>.json` for every successfully fetched locale and all Phase-1 namespaces.
- `index.json` declares the per-locale fetch provenance (time + content hash) and any missing/extra IDs.
- Scheduled CI keeps exports current by committing only changed generated artifacts.
- README's output-format section updated with the final documented schema.
