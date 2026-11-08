import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  }))).flat();
}

test('plugin instructions resolve resource paths from any working directory', async () => {
  const command = await readFile(path.join(root, 'commands/create.md'), 'utf8');
  assert.match(command, /\$CLAUDE_PLUGIN_ROOT\/skills\/slide-authoring\/SKILL\.md/);
  const author = await readFile(path.join(root, 'skills/slide-authoring/SKILL.md'), 'utf8');
  assert.match(author, /\$CLAUDE_PLUGIN_ROOT\/skills\/slide-review\/SKILL\.md/);
  assert.doesNotMatch(author, /`(?:templates|guidelines|design)\//);
  let checked = 0;
  for (const file of (await walk(root)).filter(file => file.endsWith('.md'))) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(/\$CLAUDE_PLUGIN_ROOT\/([\w./-]+)/g)) {
      const target = path.resolve(root, match[1]);
      assert.ok(target.startsWith(root), `${file}: resource escapes plugin`);
      await assert.doesNotReject(access(target), `${file}: missing ${match[1]}`);
      checked++;
    }
    for (const match of content.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
      if (match[1].includes('://') || match[1].startsWith('#')) continue;
      const target = path.resolve(path.dirname(file), match[1].split('#')[0]);
      await assert.doesNotReject(access(target), `${file}: broken link ${match[1]}`);
    }
  }
  assert.ok(checked >= 20);
});

test('gold and evaluation catalogs point to existing resources', async () => {
  const catalog = JSON.parse(await readFile(path.join(root, 'evals/gold-decks.json'), 'utf8'));
  const evals = JSON.parse(await readFile(path.join(root, 'evals/evals.json'), 'utf8'));
  assert.equal(evals.skill_name, 'slide-authoring');
  const resources = [
    ...catalog.shared_inputs,
    ...catalog.decks.flatMap(deck => [deck.source, deck.theme, deck.assets]),
    ...evals.evals.flatMap(item => item.files),
  ];
  for (const resource of resources) await assert.doesNotReject(access(path.join(root, resource)), resource);
  for (const agent of ['audience-reviewer', 'content-reviewer', 'visual-reviewer']) {
    await access(path.join(root, 'agents', `${agent}.md`));
  }
});