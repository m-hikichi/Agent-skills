import {execFile} from 'node:child_process';
import {AppError, throwIfAborted} from './errors.js';

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: {signal?: AbortSignal; cwd?: string; timeoutMs?: number; maxBuffer?: number; category?: 'dependency' | 'render'} = {},
): Promise<ProcessResult> {
  throwIfAborted(options.signal);
  return new Promise((resolve, reject) => {
    execFile(command, [...args], {
      cwd: options.cwd,
      windowsHide: true,
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
      encoding: 'utf8',
      ...(options.signal === undefined ? {} : {signal: options.signal}),
    }, (error, stdout, stderr) => {
      if (error) {
        if (options.signal?.aborted) {
          reject(new AppError('CANCELLED', 'Process was cancelled.', {category: 'cancelled', retryable: true, cause: error}));
          return;
        }
        reject(new AppError('PROCESS_FAILED', `${command} failed: ${stderr.trim() || error.message}`, {
          category: options.category ?? 'dependency',
          hint: `Command: ${command} ${args.join(' ')}`,
          cause: error,
        }));
        return;
      }
      resolve({stdout, stderr});
    });
  });
}
