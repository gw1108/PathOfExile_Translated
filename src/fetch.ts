// Stage 1: Fetcher. Downloads the Phase-1 .min.json files for every locale
// (plus the root JSON Schemas) and writes them verbatim under
// raw/<run-id>/<locale>/<file>.json with a provenance manifest.
//
// We always fetch the latest translations upstream exposes; the manifest
// (fetch time, resolved URL, content hash) is the provenance record.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  GAME,
  LOCALES,
  NAMESPACES,
  RAW_DIR,
  UPSTREAM_BASE,
  upstreamFileUrl,
  upstreamSchemaUrl,
} from './config.ts';

export interface FetchedFile {
  locale: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  fetchedAt: string;
}

export interface FailedFile {
  locale: string;
  file: string;
  url: string;
  error: string;
}

export interface Manifest {
  game: string;
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

async function readSource(location: string, attempts = 3): Promise<Buffer> {
  if (!isUrl(location)) return readFile(location);
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(location, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface FetchOptions {
  source?: string;
  rawDir?: string;
  now?: Date;
}

/** Runs a full fetch; returns the run directory and manifest. */
export async function fetchRun(opts: FetchOptions = {}): Promise<{ runDir: string; manifest: Manifest }> {
  const source = opts.source ?? UPSTREAM_BASE;
  const rawRoot = opts.rawDir ?? RAW_DIR;
  const startedAt = (opts.now ?? new Date()).toISOString();
  const runId = utcRunId(opts.now ?? new Date());
  const runDir = join(rawRoot, runId);

  const files: FetchedFile[] = [];
  const failures: FailedFile[] = [];
  const schemas: FetchedFile[] = [];

  for (const locale of LOCALES) {
    const localeDir = join(runDir, locale.code);
    await mkdir(localeDir, { recursive: true });
    for (const ns of NAMESPACES) {
      const url = upstreamFileUrl(source, locale.dir, ns.file);
      try {
        const body = await readSource(url);
        // Parse to fail fast on truncated/HTML responses; store verbatim bytes.
        JSON.parse(body.toString('utf8'));
        await writeFile(join(localeDir, `${ns.file}.json`), body);
        files.push({
          locale: locale.code,
          file: ns.file,
          url,
          sha256: createHash('sha256').update(body).digest('hex'),
          bytes: body.length,
          fetchedAt: new Date().toISOString(),
        });
        console.log(`fetched ${locale.code}/${ns.file} (${body.length} bytes)`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        failures.push({ locale: locale.code, file: ns.file, url, error });
        console.warn(`FAILED  ${locale.code}/${ns.file}: ${error}`);
      }
    }
  }

  // English is the reference locale for anomaly reporting; without it the run
  // is not usable.
  if (failures.some((f) => f.locale === 'en')) {
    throw new Error(
      `English (root) files failed to fetch: ${failures
        .filter((f) => f.locale === 'en')
        .map((f) => f.file)
        .join(', ')}`,
    );
  }

  // JSON Schemas (root only) — the upstream-format-change tripwire.
  const schemaDir = join(runDir, 'schemas');
  await mkdir(schemaDir, { recursive: true });
  for (const ns of NAMESPACES) {
    const url = upstreamSchemaUrl(isUrl(source) ? source : UPSTREAM_BASE, ns.file);
    try {
      const body = await readSource(url);
      JSON.parse(body.toString('utf8'));
      await writeFile(join(schemaDir, `${ns.file}.json`), body);
      schemas.push({
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

  const manifest: Manifest = {
    game: GAME,
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
