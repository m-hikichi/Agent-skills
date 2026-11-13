import {expect, test} from '@playwright/test';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {RuntimeService} from '../dist/core/runtime.js';
import {createWebJobQueue, createWebServiceAdapter} from '../dist/core/web-adapter.js';
import {canonicalLockHash} from '../dist/render/api.js';
import type {JobRecord} from '../dist/shared/contracts.js';
import type {ProjectLock, VideoProject} from '../dist/shared/video-types.js';
import {passingReviewGates} from '../dist/shared/review.js';
import {startWebServer, type WebJobQueue, type WebServerHandle} from '../dist/web/server.js';

let server: WebServerHandle | undefined;
let runtime: RuntimeService | undefined;
let temporaryRoot = '';
let workspaceRoot = '';

const now = new Date().toISOString();
let jobRecords: JobRecord[] = [
  {id: 'recovered-job', kind: 'storyboard', projectPath: 'e2e-project/video-project.json', status: 'interrupted', progress: 0.42, message: 'Process stopped while this job was running.', createdAt: now, updatedAt: now},
  {id: 'running-job', kind: 'resolve', projectPath: 'e2e-project/video-project.json', status: 'running', progress: 0.25, message: 'Running', createdAt: now, updatedAt: now},
];

const jobs: WebJobQueue = {
  async list() { return structuredClone(jobRecords); },
  async start(kind, projectPath) {
    const record: JobRecord = {id: `job-${jobRecords.length + 1}`, kind, projectPath, status: 'queued', progress: 0, message: 'Queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
    jobRecords = [...jobRecords, record];
    return structuredClone(record);
  },
  async get(jobId) { return structuredClone(jobRecords.find((job) => job.id === jobId)); },
  async cancel(jobId) {
    const job = jobRecords.find((candidate) => candidate.id === jobId);
    if (!job) return undefined;
    job.status = 'cancelled';
    job.message = 'Cancelled';
    job.updatedAt = new Date().toISOString();
    return structuredClone(job);
  },
};

const projectButton = (page: import('@playwright/test').Page, projectPath: string) =>
  page.locator('button.project').filter({hasText: projectPath});

const jobFor = (
  page: import('@playwright/test').Page,
  kind: JobRecord['kind'],
) => page.locator('.job').filter({has: page.getByText(kind, {exact: true})}).first();

const waitForSucceededJob = async (
  page: import('@playwright/test').Page,
  kind: JobRecord['kind'],
  timeout: number,
) => {
  const job = jobFor(page, kind);
  await expect(job).toBeVisible({timeout});
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const status = (await job.locator('span').textContent())?.trim();
    if (status === 'succeeded') return job;
    if (status && ['failed', 'cancelled', 'interrupted'].includes(status)) {
      throw new Error(`${kind} job ended as ${status}: ${(await job.textContent())?.trim() ?? ''}`);
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`${kind} job did not succeed within ${timeout}ms: ${(await job.textContent())?.trim() ?? ''}`);
};

const createCurrentLock = async (projectPath: string): Promise<ProjectLock> => {
  if (!runtime) throw new Error('Runtime did not start.');
  const envelope = await runtime.getProject(projectPath);
  const project = envelope.project;
  const scene = project.sections[0]!.scenes[0]!;
  const durationInFrames = Math.ceil((scene.durationMs ?? 3000) / 1000 * project.canvas.fps);
  const lock: ProjectLock = {
    lockVersion: '1.0.0',
    projectDigest: envelope.digest,
    lockHash: '',
    generatedAt: new Date().toISOString(),
    runtime: {node: 'v24.18.0', remotion: '4.0.503', ffmpeg: 'test', chrome: 'test', font: 'Noto Sans CJK JP'},
    assets: [],
    scenes: [{
      ...scene,
      sectionId: project.sections[0]!.id,
      sectionTitle: project.sections[0]!.title,
      startFrame: 0,
      durationInFrames,
      audioDurationMs: 0,
      subtitleText: scene.subtitle ?? scene.text ?? '',
    }],
    totalFrames: durationInFrames,
    fps: project.canvas.fps,
    credits: [],
    warnings: [],
  };
  lock.lockHash = canonicalLockHash(lock);
  const projectDirectory = path.dirname(path.join(workspaceRoot, projectPath));
  const workDirectory = path.join(projectDirectory, '.json-video-work', project.meta.id);
  await mkdir(workDirectory, {recursive: true});
  await writeFile(path.join(workDirectory, 'project.lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await writeFile(path.join(workDirectory, 'review.json'), `${JSON.stringify({status: 'pass', projectId: project.meta.id, lockHash: lock.lockHash, iteration: 1, gates: passingReviewGates(), issues: [], questionsForUser: []}, null, 2)}\n`, 'utf8');
  return lock;
};

const writePassingReviewForCurrentLock = async (projectPath: string): Promise<ProjectLock> => {
  if (!runtime) throw new Error('Runtime did not start.');
  const envelope = await runtime.getProject(projectPath);
  const projectDirectory = path.dirname(path.join(workspaceRoot, projectPath));
  const workDirectory = path.join(projectDirectory, '.json-video-work', envelope.project.meta.id);
  const lock = JSON.parse(await readFile(path.join(workDirectory, 'project.lock.json'), 'utf8')) as ProjectLock;
  await writeFile(path.join(workDirectory, 'review.json'), `${JSON.stringify({
    status: 'pass',
    projectId: envelope.project.meta.id,
    lockHash: lock.lockHash,
    iteration: 1,
    gates: passingReviewGates(),
    issues: [],
    questionsForUser: [],
  }, null, 2)}\n`, 'utf8');
  return lock;
};

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'json-video-studio-e2e-'));
  workspaceRoot = path.join(temporaryRoot, 'workspace');
  const dataRoot = path.join(temporaryRoot, 'data');
  await Promise.all([
    mkdir(workspaceRoot, {recursive: true}),
    mkdir(dataRoot, {recursive: true}),
  ]);
  process.env.JSON_VIDEO_DATA_ROOT = dataRoot;
  runtime = new RuntimeService({
    workspaceRoot,
    dataRoot,
    ...(process.env.JSON_VIDEO_SCHEMA_PATH ? {schemaPath: process.env.JSON_VIDEO_SCHEMA_PATH} : {}),
  });
  await runtime.initialize();
  server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    workspaceRoot,
    service: createWebServiceAdapter(runtime),
    jobQueue: jobs,
  });
});

test.afterAll(async () => {
  await server?.close();
  if (temporaryRoot) await rm(temporaryRoot, {recursive: true, force: true});
});

test('creates, edits, saves, reloads, and validates through the production adapter', async ({page}) => {
  if (!server) throw new Error('E2E web server did not start.');

  await page.goto(server.address);
  await expect(page.getByText('JSONから動画制作を始めましょう')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept('e2e-project'));
  await page.getByRole('button', {name: 'プロジェクトを作成'}).click();
  await expect(page.locator('header').getByRole('heading', {name: 'はじめての動画'})).toBeVisible();
  await expect(page.locator('.topbar').getByText('e2e-project/video-project.json', {exact: false})).toBeVisible();

  const settings = page.locator('.panel').filter({has: page.getByRole('heading', {name: '基本設定'})});
  await settings.getByLabel('タイトル').fill('E2Eで更新した動画');
  const saveButton = page.getByRole('button', {name: '保存', exact: true});
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(saveButton).toBeDisabled();

  await page.reload();
  await projectButton(page, 'e2e-project/video-project.json').click();
  await expect(page.locator('header').getByRole('heading', {name: 'E2Eで更新した動画'})).toBeVisible();
  await page.getByRole('button', {name: '検証'}).click();
  await expect(page.getByText('Schema検証に合格しました')).toBeVisible();

  const saved = JSON.parse(await readFile(path.join(workspaceRoot, 'e2e-project', 'video-project.json'), 'utf8')) as {meta: {title: string}};
  expect(saved.meta.title).toBe('E2Eで更新した動画');
});

test('keeps video and storyboard required while optional outputs remain editable', async ({page}) => {
  if (!server || !runtime) throw new Error('E2E runtime did not start.');
  const projectPath = 'outputs-contract/video-project.json';
  await runtime.createProject(projectPath);
  await page.goto(server.address);
  await projectButton(page, projectPath).click();

  for (const name of ['video（必須）', 'storyboard（必須）']) {
    const required = page.getByRole('checkbox', {name, exact: true});
    await expect(required).toBeChecked();
    await expect(required).toBeDisabled();
  }
  for (const name of ['captions（任意）', 'chapters（任意）', 'thumbnail（任意）']) {
    const optional = page.getByRole('checkbox', {name, exact: true});
    await expect(optional).toBeEnabled();
    await optional.click();
    await expect(optional).not.toBeChecked();
  }
});

test('reorders sections and persists the new order', async ({page}) => {
  if (!server || !runtime) throw new Error('E2E runtime did not start.');
  const projectPath = 'section-order/video-project.json';
  await runtime.createProject(projectPath);
  await page.goto(server.address);
  await projectButton(page, projectPath).click();
  await page.getByRole('button', {name: '＋ Section'}).click();
  await page.getByRole('button', {name: '＋ Section'}).click();
  const sections = page.locator('.panel.section');
  await expect(sections).toHaveCount(3);
  await sections.nth(0).locator('.panel-title .row button').nth(1).click();
  await expect(sections.nth(0).getByLabel('Section ID')).toHaveValue('section-2');
  await expect(sections.nth(1).getByLabel('Section ID')).toHaveValue('intro');
  await expect(sections.nth(2).getByLabel('Section ID')).toHaveValue('section-3');
  const saveButton = page.getByRole('button', {name: '保存', exact: true});
  await saveButton.click();
  await expect(saveButton).toBeDisabled();

  const saved = JSON.parse(await readFile(path.join(workspaceRoot, projectPath), 'utf8')) as VideoProject;
  expect(saved.sections.map((section) => section.id)).toEqual(['section-2', 'intro', 'section-3']);
});

test('reorders scenes with drag-and-drop and persists the new order', async ({page}) => {
  if (!server || !runtime) throw new Error('E2E runtime did not start.');
  const projectPath = 'scene-drag/video-project.json';
  await runtime.createProject(projectPath);

  await page.goto(server.address);
  await projectButton(page, projectPath).click();
  const section = page.locator('.panel.section').first();
  await section.getByRole('button', {name: '＋ Scene'}).click();
  const scenes = section.locator('.scene-card');
  await expect(scenes).toHaveCount(2);
  await expect(scenes.nth(0).getByLabel('Scene ID')).toHaveValue('intro-1');
  await expect(scenes.nth(1).getByLabel('Scene ID')).toHaveValue('intro-2');

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const sourceHandle = scenes.nth(0).locator('.scene-drag-handle');
  const targetCard = scenes.nth(1);
  await sourceHandle.dispatchEvent('dragstart', {dataTransfer});
  await targetCard.dispatchEvent('dragover', {dataTransfer});
  await targetCard.dispatchEvent('drop', {dataTransfer});
  await sourceHandle.dispatchEvent('dragend', {dataTransfer});
  await expect(scenes.nth(0).getByLabel('Scene ID')).toHaveValue('intro-2');
  await expect(scenes.nth(1).getByLabel('Scene ID')).toHaveValue('intro-1');
  const saveButton = page.getByRole('button', {name: '保存', exact: true});
  await saveButton.click();
  await expect(saveButton).toBeDisabled();

  const saved = JSON.parse(await readFile(path.join(workspaceRoot, projectPath), 'utf8')) as VideoProject;
  expect(saved.sections[0]?.scenes.map((scene) => scene.id)).toEqual(['intro-2', 'intro-1']);
});

test('reports a revision conflict without overwriting the winning edit', async ({page}) => {
  if (!server || !runtime) throw new Error('E2E runtime did not start.');
  const projectPath = 'conflict/video-project.json';
  await runtime.createProject(projectPath);
  await page.goto(server.address);
  await projectButton(page, projectPath).click();

  const settings = page.locator('.panel').filter({has: page.getByRole('heading', {name: '基本設定'})});
  await settings.getByLabel('タイトル').fill('ブラウザー側の競合編集');
  const current = await runtime.getProject(projectPath);
  const winner: VideoProject = structuredClone(current.project);
  winner.meta.title = '外部で先に保存された編集';
  await runtime.updateProject(projectPath, winner, current.revision);

  await page.getByRole('button', {name: '保存', exact: true}).click();
  await expect(page.locator('.notice.error')).toContainText('Expected revision');
  const saved = JSON.parse(await readFile(path.join(workspaceRoot, projectPath), 'utf8')) as VideoProject;
  expect(saved.meta.title).toBe('外部で先に保存された編集');
});

test('disables render immediately after a current lock becomes stale', async ({page}) => {
  if (!server || !runtime) throw new Error('E2E runtime did not start.');
  const projectPath = 'stale/video-project.json';
  await runtime.createProject(projectPath);
  const lock = await createCurrentLock(projectPath);
  expect((await runtime.getProject(projectPath)).lockState).toBe('current');

  await page.goto(server.address);
  await projectButton(page, projectPath).click();
  await page.getByRole('button', {name: 'Jobs', exact: true}).click();
  const renderButton = page.getByRole('button', {name: 'Render'});
  await expect(renderButton).toBeEnabled();

  await page.getByRole('button', {name: '編集', exact: true}).click();
  const settings = page.locator('.panel').filter({has: page.getByRole('heading', {name: '基本設定'})});
  await settings.getByLabel('タイトル').fill('lockをstaleにする編集');
  const saveButton = page.getByRole('button', {name: '保存', exact: true});
  await saveButton.click();
  await expect(saveButton).toBeDisabled();
  await expect(page.locator('.topbar')).toContainText('lock: stale');
  await page.getByRole('button', {name: 'Jobs', exact: true}).click();
  await expect(renderButton).toBeDisabled();
  expect(lock.lockHash).toHaveLength(64);
});

test('compares current and prior storyboards scene-by-scene', async ({page}) => {
  if (!server || !runtime) throw new Error('E2E runtime did not start.');
  const projectPath = 'storyboard-compare/video-project.json';
  const created = await runtime.createProject(projectPath);
  const currentLock = await createCurrentLock(projectPath);
  const priorHash = 'a'.repeat(64);
  const storyboardRoot = path.join(
    workspaceRoot,
    'storyboard-compare',
    '.json-video-work',
    created.project.meta.id,
    'storyboard',
  );
  const [currentRoot, priorRoot] = [currentLock.lockHash, priorHash].map((hash) => path.join(storyboardRoot, hash));
  await Promise.all([mkdir(currentRoot, {recursive: true}), mkdir(priorRoot, {recursive: true})]);
  const frame = await readFile(path.resolve(process.cwd(), 'tests', 'fixtures', 'all-templates-media.png'));
  await Promise.all([
    writeFile(path.join(currentRoot, '001-intro-1.png'), frame),
    writeFile(path.join(priorRoot, '001-intro-1.png'), frame),
    writeFile(path.join(priorRoot, '002-removed-scene.png'), frame),
  ]);

  await page.goto(server.address);
  await projectButton(page, projectPath).click();
  await page.getByRole('button', {name: '成果物'}).click();
  const comparison = page.getByLabel('Storyboard比較');
  await expect(comparison).toBeVisible();
  await expect(comparison.getByLabel('左のStoryboard')).toHaveValue(priorHash);
  await expect(comparison.getByLabel('右のStoryboard')).toHaveValue(currentLock.lockHash);
  await expect(comparison.locator('.storyboard-compare-group')).toHaveCount(2);
  await expect(comparison.locator('[data-scene-id="intro-1"]')).toContainText('両方に存在');
  await expect(comparison.locator('[data-scene-id="removed-scene"]')).toContainText('右では削除');
});

test('shows recovered interrupted jobs and cancels a running job', async ({page}) => {
  if (!server || !runtime) throw new Error('E2E runtime did not start.');
  const projectPath = 'jobs-view/video-project.json';
  await runtime.createProject(projectPath);
  await page.goto(server.address);
  await projectButton(page, projectPath).click();
  await page.getByRole('button', {name: 'Jobs', exact: true}).click();

  const interrupted = page.locator('.job').filter({has: page.locator('span').filter({hasText: /^interrupted$/u})});
  await expect(interrupted).toContainText('Process stopped while this job was running.');
  const running = page.locator('.job').filter({has: page.locator('span').filter({hasText: /^running$/u})});
  await running.getByRole('button', {name: 'キャンセル'}).click();
  await expect(page.locator('.job').filter({has: page.locator('span').filter({hasText: /^cancelled$/u})})).toBeVisible();
});

test('completes a silent sample through the production job queue and exposes its outputs', async ({page}) => {
  test.setTimeout(600_000);
  const activeRuntime = runtime;
  if (!activeRuntime) throw new Error('E2E runtime did not start.');
  const projectPath = 'production-flow/video-project.json';
  const productionServer = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    workspaceRoot,
    service: createWebServiceAdapter(activeRuntime),
    jobQueue: createWebJobQueue(activeRuntime),
  });

  try {
    await page.goto(productionServer.address);
    page.once('dialog', (dialog) => dialog.accept('production-flow'));
    await page.getByRole('button', {name: 'プロジェクトを作成'}).click();
    await expect(page.locator('.topbar')).toContainText(projectPath);

    await page.getByRole('button', {name: 'Jobs', exact: true}).click();
    await page.getByRole('button', {name: 'Resolve', exact: true}).click();
    await waitForSucceededJob(page, 'resolve', 60_000);

    const storyboardButton = page.getByRole('button', {name: 'Storyboard', exact: true});
    await expect(storyboardButton).toBeEnabled({timeout: 30_000});
    await storyboardButton.click();
    await waitForSucceededJob(page, 'storyboard', 120_000);

    const lock = await writePassingReviewForCurrentLock(projectPath);
    expect(lock.lockHash).toHaveLength(64);
    await page.reload();
    await projectButton(page, projectPath).click();
    await page.getByRole('button', {name: 'Jobs', exact: true}).click();
    const renderButton = page.getByRole('button', {name: 'Render', exact: true});
    await expect(renderButton).toBeEnabled({timeout: 30_000});
    await renderButton.click();
    await waitForSucceededJob(page, 'render', 240_000);

    await page.getByRole('button', {name: '成果物'}).click();
    await page.getByRole('button', {name: '再読込'}).click();
    for (const name of ['video.mp4', 'thumbnail.png', 'artifact-manifest.json', 'project.lock.json']) {
      await expect(page.locator('.output > strong').filter({hasText: name})).toBeVisible({timeout: 30_000});
    }
  } finally {
    for (const job of activeRuntime.jobs.list().filter((record) => record.status === 'queued' || record.status === 'running')) {
      await activeRuntime.jobs.cancel(job.id);
    }
    await activeRuntime.jobs.drain();
    await productionServer.close();
  }
});
