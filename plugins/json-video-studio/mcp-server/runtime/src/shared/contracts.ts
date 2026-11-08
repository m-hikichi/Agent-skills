export type JobKind = 'resolve' | 'storyboard' | 'render';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface StructuredError {
  code: string;
  message: string;
  jsonPointer?: string;
  hint?: string;
  retryable: boolean;
  jobId?: string;
}

export interface JobRecord {
  id: string;
  kind: JobKind;
  projectPath: string;
  status: JobStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  result?: Record<string, unknown>;
  error?: StructuredError;
}

export interface ProjectEnvelope<T = unknown> {
  project: T;
  revision: number;
  digest: string;
  lockState: 'missing' | 'current' | 'stale';
}

/** A generated scene frame that is safe to request through the storyboard API. */
export interface StoryboardFrameSummary {
  index: number;
  sceneId: string;
  filename: string;
}

/** One immutable storyboard run, identified by the lock that produced it. */
export interface StoryboardRunSummary {
  lockHash: string;
  isCurrent: boolean;
  createdAt: string;
  frames: StoryboardFrameSummary[];
}
