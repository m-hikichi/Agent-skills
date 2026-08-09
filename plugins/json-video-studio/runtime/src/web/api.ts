export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown) {
    super(message);
  }
}

export const apiRequest = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  const method = init.method ?? 'GET';
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) headers.set('x-json-video-studio', '1');
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(url, {...init, headers});
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
    throw new ApiError(String(record?.message ?? `HTTP ${response.status}`), response.status, payload);
  }
  return payload as T;
};
