const json = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), body);
  return body;
};

const opts = (method, body) => ({
  method,
  credentials: 'include',
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

// { mode, start, end } -> URLSearchParams fragment. mode omitted -> server default.
const rangeParams = ({ mode, start, end } = {}) => {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (mode === 'custom') {
    if (start) params.set('start', start);
    if (end) params.set('end', end);
  }
  return params;
};

export const api = {
  status: () => fetch('/api/auth/status', opts('GET')).then(json),
  connectUrl: () => fetch('/api/auth/connect', opts('GET')).then(json),
  // The server takes the company to disconnect from the session, not from
  // this body — the argument is kept only so existing call sites read
  // clearly, and is ignored server-side.
  disconnect: () => fetch('/api/auth/disconnect', opts('POST', {})).then(json),

  cachedSummary: (range) =>
    fetch(`/api/summary/cached?${rangeParams(range)}`, opts('GET')).then(json),
  summary: ({ force = false, ...range } = {}) => {
    const params = rangeParams(range);
    params.set('force', force);
    return fetch(`/api/summary?${params}`, opts('GET')).then(json);
  },
  schedule: () => fetch('/api/summary/schedule', opts('GET')).then(json),

  exportUrl: (format, range) => `/api/summary/export/${format}?${rangeParams(range)}`,

  /**
   * Rebuild while streaming stage updates. Returns an abort function so the
   * component can cancel cleanly on unmount.
   */
  streamSummary({ onProgress, onCounts, onDone, onError, ...range }) {
    const source = new EventSource(`/api/summary/stream?${rangeParams(range)}`, {
      withCredentials: true,
    });
    source.addEventListener('progress', (e) => onProgress?.(JSON.parse(e.data)));
    source.addEventListener('counts', (e) => onCounts?.(JSON.parse(e.data)));
    source.addEventListener('summary', (e) => {
      onDone?.(JSON.parse(e.data));
      source.close();
    });
    source.addEventListener('failed', (e) => {
      onError?.(JSON.parse(e.data));
      source.close();
    });
    source.onerror = () => {
      onError?.({ error: 'Lost the connection to the server while building the summary.' });
      source.close();
    };
    return () => source.close();
  },
};
