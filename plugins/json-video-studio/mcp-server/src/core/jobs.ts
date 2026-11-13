import {randomUUID} from 'node:crypto';
import {mkdir, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {JobKind, JobRecord} from '../shared/contracts.js';
import {AppError, asAppError} from './errors.js';
import {atomicWriteJson, readJson} from './fs-safe.js';

export interface JobContext {
  signal: AbortSignal;
  update: (progress: number, message: string) => Promise<void>;
  jobId: string;
}

export interface JobRequest {
  kind: JobKind;
  projectPath: string;
  input?: Record<string, unknown>;
}

interface PersistedJob extends JobRecord {
  input?: Record<string, unknown>;
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const JOB_KINDS = new Set<JobKind>(['resolve', 'storyboard', 'render']);
const JOB_STATUSES = new Set<JobRecord['status']>(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']);

function isPersistedJob(value: unknown, filenameId: string): value is PersistedJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return JOB_ID.test(filenameId)
    && record.id === filenameId
    && typeof record.kind === 'string'
    && JOB_KINDS.has(record.kind as JobKind)
    && typeof record.projectPath === 'string'
    && record.projectPath.length > 0
    && record.projectPath.length <= 1024
    && typeof record.status === 'string'
    && JOB_STATUSES.has(record.status as JobRecord['status'])
    && typeof record.progress === 'number'
    && Number.isFinite(record.progress)
    && record.progress >= 0
    && record.progress <= 1
    && typeof record.message === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string';
}

export type JobHandler = (request: JobRequest, context: JobContext) => Promise<Record<string, unknown>>;

export interface JobQueueOptions {
  stateRoot: string;
  handlers: Partial<Record<JobKind, JobHandler>>;
}

export class JobQueue {
  private readonly stateRoot: string;
  private readonly handlers: Partial<Record<JobKind, JobHandler>>;
  private readonly records = new Map<string, PersistedJob>();
  private readonly pending: string[] = [];
  private active?: {id: string; controller: AbortController};
  private pumpPromise?: Promise<void>;

  constructor(options: JobQueueOptions) {
    this.stateRoot = resolve(options.stateRoot);
    this.handlers = options.handlers;
  }

  async initialize(): Promise<void> {
    await mkdir(this.stateRoot, {recursive: true});
    const files = (await readdir(this.stateRoot)).filter((file) => JOB_ID.test(file.slice(0, -5)) && file.endsWith('.json')).sort();
    for (const file of files) {
      try {
        const filenameId = file.slice(0, -5);
        const value = await readJson<unknown>(resolve(this.stateRoot, file));
        if (!isPersistedJob(value, filenameId)) continue;
        const record = value;
        if (record.status === 'running') {
          record.status = 'interrupted';
          record.message = 'Process stopped while this job was running.';
          record.updatedAt = new Date().toISOString();
          await this.persist(record);
        }
        this.records.set(record.id, record);
        if (record.status === 'queued') this.pending.push(record.id);
      } catch {
        // Ignore unrelated or corrupt files; callers can inspect logs and remove them manually.
      }
    }
    this.ensurePump();
  }

  async start(request: JobRequest): Promise<JobRecord> {
    if (!this.handlers[request.kind]) {
      throw new AppError('JOB_HANDLER_MISSING', `No handler is configured for ${request.kind}.`, {
        category: 'dependency',
      });
    }
    const now = new Date().toISOString();
    const record: PersistedJob = {
      id: randomUUID(),
      kind: request.kind,
      projectPath: request.projectPath,
      status: 'queued',
      progress: 0,
      message: 'Queued',
      createdAt: now,
      updatedAt: now,
      ...(request.input === undefined ? {} : {input: request.input}),
    };
    this.records.set(record.id, record);
    this.pending.push(record.id);
    await this.persist(record);
    this.ensurePump();
    return publicRecord(record);
  }

  get(id: string): JobRecord {
    const record = this.records.get(id);
    if (!record) throw new AppError('JOB_NOT_FOUND', `Unknown job: ${id}`, {category: 'schema'});
    return publicRecord(record);
  }

  list(): JobRecord[] {
    return [...this.records.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicRecord);
  }

  async cancel(id: string): Promise<JobRecord> {
    const record = this.records.get(id);
    if (!record) throw new AppError('JOB_NOT_FOUND', `Unknown job: ${id}`, {category: 'schema'});
    if (record.status === 'queued') {
      const index = this.pending.indexOf(id);
      if (index >= 0) this.pending.splice(index, 1);
      record.status = 'cancelled';
      record.progress = 0;
      record.message = 'Cancelled before start.';
      record.updatedAt = new Date().toISOString();
      await this.persist(record);
    } else if (record.status === 'running' && this.active?.id === id) {
      this.active.controller.abort();
    }
    return publicRecord(record);
  }

  async drain(): Promise<void> {
    while (this.pumpPromise) await this.pumpPromise;
  }

  private ensurePump(): void {
    if (this.pumpPromise || this.pending.length === 0) return;
    this.pumpPromise = this.pump().finally(() => {
      this.pumpPromise = undefined;
      if (this.pending.length > 0) this.ensurePump();
    });
  }

  private async pump(): Promise<void> {
    while (this.pending.length > 0) {
      const id = this.pending.shift();
      if (!id) continue;
      const record = this.records.get(id);
      if (!record || record.status !== 'queued') continue;
      const handler = this.handlers[record.kind];
      if (!handler) {
        await this.fail(record, new AppError('JOB_HANDLER_MISSING', `No handler for ${record.kind}.`, {category: 'dependency'}));
        continue;
      }
      const controller = new AbortController();
      this.active = {id, controller};
      record.status = 'running';
      record.message = 'Running';
      record.updatedAt = new Date().toISOString();
      await this.persist(record);
      try {
        let updateTail = Promise.resolve();
        const request: JobRequest = {
          kind: record.kind,
          projectPath: record.projectPath,
          ...(record.input === undefined ? {} : {input: record.input}),
        };
        const result = await handler(request, {
          signal: controller.signal,
          jobId: id,
          update: (progress, message) => {
            updateTail = updateTail.then(async () => {
              if (record.status !== 'running') return;
              record.progress = Math.max(record.progress, Math.min(0.99, Math.max(0, progress)));
              record.message = message;
              record.updatedAt = new Date().toISOString();
              await this.persist(record);
            });
            return updateTail;
          },
        });
        await updateTail;
        if (controller.signal.aborted) {
          record.status = 'cancelled';
          record.message = 'Cancelled';
        } else {
          record.status = 'succeeded';
          record.progress = 1;
          record.message = 'Succeeded';
          record.result = result;
        }
        record.updatedAt = new Date().toISOString();
        await this.persist(record);
      } catch (error) {
        if (controller.signal.aborted) {
          record.status = 'cancelled';
          record.message = 'Cancelled';
          record.updatedAt = new Date().toISOString();
          await this.persist(record);
        } else {
          await this.fail(record, error);
        }
      } finally {
        this.active = undefined;
      }
    }
  }

  private async fail(record: PersistedJob, error: unknown): Promise<void> {
    const appError = asAppError(error, 'JOB_FAILED');
    record.status = 'failed';
    record.message = appError.message;
    record.error = {...appError.toJSON(), jobId: record.id};
    record.updatedAt = new Date().toISOString();
    await this.persist(record);
  }

  private persist(record: PersistedJob): Promise<void> {
    if (!JOB_ID.test(record.id)) {
      return Promise.reject(new AppError('JOB_RECORD_INVALID', 'Refusing to persist a job with an invalid id.', {category: 'policy'}));
    }
    return atomicWriteJson(resolve(this.stateRoot, `${record.id}.json`), record, {overwrite: true});
  }
}

function publicRecord(record: PersistedJob): JobRecord {
  const {input: _input, ...result} = record;
  return structuredClone(result);
}
