import {Client} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
const [mode, name = 'dialogue'] = process.argv.slice(2);
const client = new Client({name: 'quality-verification', version: '1.0.0'});
const transport = new StdioClientTransport({command: 'node', args: ['/app/dist/mcp/index.js'], env: {...process.env}, stderr: 'inherit'});
await client.connect(transport);
let sequence = 0;
async function call(name, args = {}) {
  const response = await client.callTool({name, arguments: args});
  const value = JSON.parse(response.content.find(c => c.type === 'text').text);
  if (response.isError) throw new Error(JSON.stringify(value));
  return value;
}
async function job(tool, args) {
  const started = await call(tool, args);
  console.log(JSON.stringify({tool, started}));
  const jobId = started.id ?? started.jobId;
  if (!jobId) throw new Error('No job id');
  let previous = '';
  while (true) {
    const current = await call('job_status', {jobId});
    const summary = JSON.stringify({status: current.status, progress: current.progress});
    if (summary !== previous) {console.log(summary); previous = summary;}
    if (['succeeded', 'failed', 'interrupted', 'cancelled'].includes(current.status)) {
      await writeFile(`/workspace/logs/${name}-${mode}-${++sequence}-${tool}.json`, JSON.stringify(current, null, 2));
      if (current.status !== 'succeeded') throw new Error(JSON.stringify(current));
      return current.result;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}
try {
  const projectPath = `${name}/video-project.json`;
  if (mode === 'prepare') {
    const doctor = await call('doctor');
    await writeFile('/workspace/logs/doctor.json', JSON.stringify(doctor, null, 2));
    if (!doctor.ok) throw new Error(JSON.stringify(doctor));
    const project = JSON.parse(await readFile(`/workspace/inputs/${name}.json`, 'utf8'));
    const result = await call('project_create', {projectPath, project});
    await mkdir(`/workspace/${name}/.json-video-work/${project.meta.id}`, {recursive: true});
    await writeFile(`/workspace/${name}/.json-video-work/${project.meta.id}/request.json`, JSON.stringify({projectId: project.meta.id, goal: 'Docker MCPによる生成可否と映像品質の検証', audience: 'プラグイン利用者', title: project.meta.title, source: `inputs/${name}.json`, lastProjectRevision: result.revision}, null, 2));
    await call('project_validate', {projectPath});
    await job('resolve_start', {projectPath, dryRun: true});
    await job('resolve_start', {projectPath});
    console.log(JSON.stringify(await job('storyboard_start', {projectPath})));
  } else if (mode === 'refresh') {
    const current = await call('project_get', {projectPath});
    const project = JSON.parse(await readFile(`/workspace/inputs/${name}.json`, 'utf8'));
    await call('project_update', {projectPath, expectedRevision: current.revision, project});
    await call('project_validate', {projectPath});
    await job('resolve_start', {projectPath, dryRun: true});
    await job('resolve_start', {projectPath});
    console.log(JSON.stringify(await job('storyboard_start', {projectPath})));
  } else if (mode === 'storyboard') {
    console.log(JSON.stringify(await job('storyboard_start', {projectPath, outputDir: `${name}/review-storyboard-v2`})));
  } else if (mode === 'render') {
    const result = await job('render_start', {projectPath});
    await writeFile(`/workspace/logs/${name}-render-result.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } else if (mode === 'inspect') {
    const outputDirectory = process.argv[4];
    const result = await call('output_inspect', {outputDirectory});
    await writeFile(`/workspace/logs/${name}-inspection.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({media: result.media, checks: result.checks, thumbnail: result.thumbnail}));
  }
} finally {await client.close();}
