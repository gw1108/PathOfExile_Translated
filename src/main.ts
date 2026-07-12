// Pipeline orchestrator: fetch → ingest → export, once per game.
//
//   node src/main.ts                 fetch latest upstream, then build dist/
//   node src/main.ts --skip-fetch    rebuild dist/ from the latest raw run
//   node src/main.ts --run-id <id>   rebuild dist/ from a specific raw run
//   node src/main.ts --source <url|path>   fetch from a mirror instead
//   node src/main.ts --game <poe1|poe2>    limit to one game (default: all)

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAMES, RAW_DIR, gameConfig } from './config.ts';
import { exportRun } from './export.ts';
import { fetchRun, type Manifest } from './fetch.ts';
import { ingestRun } from './ingest.ts';

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function runPipeline(args: string[] = []): Promise<void> {
  const gameArg = argValue(args, '--game');
  let games = gameArg ? [gameConfig(gameArg)] : [...GAMES];

  let runDir: string;
  if (args.includes('--skip-fetch') || args.includes('--run-id')) {
    const runId =
      argValue(args, '--run-id')
      ?? (JSON.parse(await readFile(join(RAW_DIR, 'latest.json'), 'utf8')) as { runId: string }).runId;
    runDir = join(RAW_DIR, runId);
    console.log(`using existing raw run ${runId}`);
    // Only rebuild games the run actually contains (legacy manifests are poe1-only).
    try {
      const manifest = JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8')) as Manifest;
      const fetched = manifest.games ?? ['poe1'];
      games = games.filter((g) => fetched.includes(g.game));
    } catch {
      // No manifest (fixtures/partial runs): attempt whatever was requested.
    }
  } else {
    ({ runDir } = await fetchRun({ source: argValue(args, '--source'), games }));
  }

  for (const game of games) {
    const result = await ingestRun(runDir, game);
    console.log(`${game.game}: ingested ${result.terms.size} terms`);
    for (const problem of result.report.fileProblems) console.warn(`${game.game} problem: ${problem}`);
    for (const note of result.report.schemaNotes) console.warn(`${game.game} schema: ${note}`);

    const summary = await exportRun(result);
    console.log(`${game.game}: exported to ${summary.outDir} (contentHash ${summary.contentHash.slice(0, 12)}…)`);
    for (const [locale, count] of Object.entries(summary.localeCounts)) {
      console.log(`  ${locale}: ${count} terms`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runPipeline(process.argv.slice(2));
}
