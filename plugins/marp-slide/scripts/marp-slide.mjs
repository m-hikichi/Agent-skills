#!/usr/bin/env node

import {
  LifecycleError,
  fileFingerprint,
  finalizeRun,
  gateRun,
  initializeRun,
  lintDeck,
  prepareReview,
  transitionRun,
  validateCurrentReview,
} from './lib/core.mjs';

const COMMANDS = new Set(['init', 'set-status', 'lint', 'fingerprint', 'prepare-review', 'validate-review', 'finalize', 'gate']);
const VALUE_OPTIONS = new Set([
  'root',
  'source',
  'theme',
  'request',
  'asset-manifest',
  'render-manifest',
  'review',
  'state',
  'pages-dir',
  'deck-plan',
  'storyboard',
  'target',
  'slide-count-mode',
  'status',
  'message',
]);
const BOOLEAN_OPTIONS = new Set(['force', 'no-sync-state', 'help']);

function camelCase(name) {
  return name.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') return { command: 'help', options: {} };
  if (!COMMANDS.has(command)) throw new LifecycleError(`Unknown command: ${command}`);
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new LifecycleError(`Unexpected positional argument: ${token}`);
    const name = token.slice(2);
    if (BOOLEAN_OPTIONS.has(name)) {
      options[camelCase(name)] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) throw new LifecycleError(`Unknown option: --${name}`);
    if (index + 1 >= rest.length || rest[index + 1].startsWith('--')) throw new LifecycleError(`Option --${name} requires a value`);
    options[camelCase(name)] = rest[index + 1];
    index += 1;
  }
  return { command, options };
}

function usage() {
  return `marp-slide lifecycle CLI (rubric v3)

Usage:
  node scripts/marp-slide.mjs init [--status active|needs_user|blocked] [--force]
  node scripts/marp-slide.mjs set-status --status active|needs_user|blocked [--message TEXT]
  node scripts/marp-slide.mjs lint [--target N] [--slide-count-mode exact|target|flexible]
  node scripts/marp-slide.mjs fingerprint
  node scripts/marp-slide.mjs prepare-review
  node scripts/marp-slide.mjs validate-review [--no-sync-state]
  node scripts/marp-slide.mjs finalize
  node scripts/marp-slide.mjs gate

Common path options (all must remain inside --root):
  --root DIR                  workspace root (default: current directory)
  --source FILE              default: slides/presentation.md
  --theme FILE               default: slides/theme.css; omitted file permits legacy inline CSS
  --request FILE             default: .slide-work/request.yaml
  --asset-manifest FILE      default: .slide-work/asset-manifest.json
  --render-manifest FILE     default: .slide-work/render-manifest.json
  --review FILE              default: .slide-work/review.json
  --state FILE               default: .slide-work/run-state.json
  --pages-dir DIR            default: .slide-work/rendered-pages
  --deck-plan FILE           default: .slide-work/deck-plan.json (validated by lint when present)
  --storyboard FILE          default: .slide-work/storyboard.md (required for an initialized v1 run)

Exit codes: 0 success, 1 invalid input/artifact, 2 Stop hook intentionally blocks an active or stale-complete run.`;
}

function print(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === 'help' || options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === 'init') {
    print({ ok: true, command, ...(await initializeRun(options)) });
    return;
  }
  if (command === 'set-status') {
    print({ ok: true, command, ...(await transitionRun(options)) });
    return;
  }
  if (command === 'lint') {
    const result = await lintDeck(options);
    print({ command, ...result });
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'fingerprint') {
    print({ ok: true, command, ...(await fileFingerprint(options)) });
    return;
  }
  if (command === 'prepare-review') {
    print({ ok: true, command, ...(await prepareReview(options)) });
    return;
  }
  if (command === 'validate-review') {
    const validated = await validateCurrentReview(options, {
      syncState: !options.noSyncState,
      requirePass: false,
      requireFinalRender: false,
    });
    print({
      ok: true,
      command,
      status: validated.review.review.status,
      artifact_fingerprint: validated.context.fingerprint,
      render_iteration: validated.render.manifest.render_iteration,
      review_attempt: validated.review.review.review_attempt,
      state_updated: !options.noSyncState,
      run_status: validated.state?.status ?? null,
    });
    return;
  }
  if (command === 'finalize') {
    print({ ok: true, command, ...(await finalizeRun(options)) });
    return;
  }
  if (command === 'gate') {
    print({ ok: true, command, ...(await gateRun(options)) });
  }
}

main().catch((error) => {
  const lifecycle = error instanceof LifecycleError ? error : new LifecycleError(`Unexpected error: ${error.stack ?? error.message}`);
  print(
    {
      ok: false,
      error: lifecycle.message,
      details: lifecycle.details ?? [],
    },
    process.stderr,
  );
  process.exitCode = lifecycle.exitCode ?? 1;
});
