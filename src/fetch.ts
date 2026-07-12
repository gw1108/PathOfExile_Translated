// Stage 1: Fetcher. Downloads the .min.json files for every game and locale
// (plus the poe1 JSON Schemas) and writes them verbatim under
// raw/<run-id>/<game>/<locale>/<file>.json with a provenance manifest.
//
// We always fetch the latest translations upstream exposes; the manifest
// (fetch time, resolved URL, content hash) is the provenance record.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  GAMES,
  RAW_DIR,
  UPSTREAM_BASE,
  upstreamDirUrl,
  upstreamFileUrl,
  upstreamSchemaUrl,
  type GameConfig,
} from './config.ts';

export interface FetchedFile {
  game: string;
  locale: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  fetchedAt: string;
}

export interface FailedFile {
  game: string;
  locale: string;
  file: string;
  url: string;
  error: string;
}

export interface Manifest {
  games: string[];
  runId: string;
  source: string;
  startedAt: string;
  finishedAt: string;
  files: FetchedFile[];
  failures: FailedFile[];
  schemas: FetchedFile[];
}

function utcRunId(now: Date): string {
  // Colon-free UTC timestamp so it is a valid directory name on Windows.
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');
}

const isUrl = (s: string) => /^https?:\/\//.test(s);

/** Thrown for HTTP 4xx: the file does not exist upstream; retrying is pointless. */
class NotAvailableError extends Error {}

async function readSource(location: string, attempts = 3): Promise<Buffer> {
  if (!isUrl(location)) return readFile(location);
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(location, { redirect: 'follow' });
      if (res.status >= 400 && res.status < 500) throw new NotAvailableError(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (err instanceof NotAvailableError) throw err;
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Enumerates a data directory's `.min.json` basenames. Local mirrors are
 * read with readdir; for the site, the CI-generated index.html listing is
 * parsed.
 */
async function listDirFiles(location: string): Promise<string[]> {
  if (!isUrl(location)) {
    const names = await readdir(location);
    return names.filter((n) => n.endsWith('.min.json')).map((n) => n.replace(/\.min\.json$/, '')).sort();
  }
  const res = await fetch(location.replace(/\/$/, '') + '/', { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const names = [...html.matchAll(/href="\.?\/?([^"/]+)\.min\.json"/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

export interface FetchOptions {
  source?: string;
  rawDir?: string;
  now?: Date;
  /** Games to fetch; defaults to all configured games. */
  games?: readonly GameConfig[];
}

/** Runs a full fetch; returns the run directory and manifest. */
export async function fetchRun(opts: FetchOptions = {}): Promise<{ runDir: string; manifest: Manifest }> {
  const source = opts.source ?? UPSTREAM_BASE;
  const rawRoot = opts.rawDir ?? RAW_DIR;
  const games = opts.games ?? GAMES;
  const startedAt = (opts.now ?? new Date()).toISOString();
  const runId = utcRunId(opts.now ?? new Date());
  const runDir = join(rawRoot, runId);

  const files: FetchedFile[] = [];
  const failures: FailedFile[] = [];
  const schemas: FetchedFile[] = [];

  for (const game of games) {
    // A directory namespace's file list, enumerated once from English.
    // Files under these paths are optional per-locale (never en-fatal).
    const dirFiles = new Map<string, string[]>();
    for (const ns of game.namespaces) {
      if (!ns.directory || dirFiles.has(ns.file)) continue;
      const dirUrl = upstreamDirUrl(source, game, '', ns.file);
      try {
        dirFiles.set(ns.file, await listDirFiles(dirUrl));
      } catch (err) {
        dirFiles.set(ns.file, []);
        const error = err instanceof Error ? err.message : String(err);
        failures.push({ game: game.game, locale: 'en', file: ns.file, url: dirUrl, error: `directory listing: ${error}` });
        console.warn(`FAILED  ${game.game} directory listing ${ns.file}: ${error}`);
      }
    }
    const isDirDerived = (file: string) =>
      [...dirFiles.keys()].some((dir) => file.startsWith(`${dir}/`) || file === dir);

    for (const locale of game.locales) {
      const localeDir = join(runDir, game.game, locale.code);
      await mkdir(localeDir, { recursive: true });
      const fetched = new Set<string>(); // several namespaces may share one file
      for (const ns of game.namespaces) {
        const nsFiles = ns.directory
          ? (dirFiles.get(ns.file) ?? []).map((base) => `${ns.file}/${base}`)
          : [ns.file];
        for (const file of nsFiles) {
          if (fetched.has(file)) continue;
          fetched.add(file);
          const url = upstreamFileUrl(source, game, locale.dir, file);
          try {
            const body = await readSource(url);
            // Parse to fail fast on truncated/HTML responses; store verbatim bytes.
            JSON.parse(body.toString('utf8'));
            const outPath = join(localeDir, `${file}.json`);
            await mkdir(dirname(outPath), { recursive: true });
            await writeFile(outPath, body);
            files.push({
              game: game.game,
              locale: locale.code,
              file,
              url,
              sha256: createHash('sha256').update(body).digest('hex'),
              bytes: body.length,
              fetchedAt: new Date().toISOString(),
            });
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            failures.push({ game: game.game, locale: locale.code, file, url, error });
            console.warn(`FAILED  ${game.game}/${locale.code}/${file}: ${error}`);
          }
        }
      }
      console.log(`fetched ${game.game}/${locale.code}: ${fetched.size} files`);
    }

    // English is the reference locale for anomaly reporting; without it the
    // game's portion of the run is not usable. Directory-derived files are
    // optional (their sets can change per patch).
    const enFailures = failures.filter(
      (f) => f.game === game.game && f.locale === 'en' && !isDirDerived(f.file),
    );
    if (enFailures.length > 0) {
      throw new Error(
        `${game.game} English (root) files failed to fetch: ${enFailures.map((f) => f.file).join(', ')}`,
      );
    }

    // JSON Schemas (root only) — the upstream-format-change tripwire.
    // poe2 publishes no data-formats directory; ingest degrades to
    // adapter-level checks there.
    if (!game.hasSchemas) continue;
    const schemaDir = join(runDir, game.game, 'schemas');
    await mkdir(schemaDir, { recursive: true });
    const schemaFetched = new Set<string>();
    for (const ns of game.namespaces) {
      if (ns.validateSchema === false || ns.directory || schemaFetched.has(ns.file)) continue;
      schemaFetched.add(ns.file);
      const url = upstreamSchemaUrl(isUrl(source) ? source : UPSTREAM_BASE, ns.file);
      try {
        const body = await readSource(url);
        JSON.parse(body.toString('utf8'));
        const outPath = join(schemaDir, `${ns.file}.json`);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, body);
        schemas.push({
          game: game.game,
          locale: 'schema',
          file: ns.file,
          url,
          sha256: createHash('sha256').update(body).digest('hex'),
          bytes: body.length,
          fetchedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(`schema unavailable for ${ns.file}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const manifest: Manifest = {
    games: games.map((g) => g.game),
    runId,
    source,
    startedAt,
    finishedAt: new Date().toISOString(),
    files,
    failures,
    schemas,
  };
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  // Pointer to the most recent run (symlinks are unreliable on Windows).
  await writeFile(join(rawRoot, 'latest.json'), JSON.stringify({ runId }, null, 2) + '\n', 'utf8');
  console.log(`run ${runId}: ${files.length} files fetched, ${failures.length} failures`);
  return { runDir, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf('--source');
  await fetchRun({ source: sourceIdx >= 0 ? args[sourceIdx + 1] : undefined });
}
