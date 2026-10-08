// API client.
const store = {
  get user() { return localStorage.getItem('gvs.user') || ''; },
  set user(v) { localStorage.setItem('gvs.user', v); },
  get token() { return localStorage.getItem('gvs.token') || ''; },
  set token(v) { localStorage.setItem('gvs.token', v); },
};

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

export function authHeaders() {
  const headers = {};
  if (store.user) headers['X-User'] = encodeURIComponent(store.user);
  if (store.token) headers.Authorization = `Bearer ${store.token}`;
  return headers;
}

export async function request(method, url, body) {
  const headers = { ...authHeaders() };
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch (err) {
    throw new ApiError(0, 'Não foi possível conectar ao servidor');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('gvs:unauthorized'));
    throw new ApiError(res.status, data?.error || `Erro ${res.status}`, data?.details);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  delete: (url) => request('DELETE', url),
  store,
  fileUrl: (assetId, { download = false } = {}) => withToken(`/api/assets/${assetId}/file${download ? '?download=1' : ''}`),
  previewUrl: (assetId, { kind } = {}) => withToken(`/api/assets/${assetId}/preview${kind ? `?kind=${kind}` : ''}`),
  thumbUrl: (assetId, stamp) => withToken(`/api/assets/${assetId}/thumb${stamp ? `?v=${encodeURIComponent(stamp)}` : ''}`),
  versionUrl: (assetId, versionId) => withToken(`/api/assets/${assetId}/versions/${versionId}/file?download=1`),
  exportUrl: (eventId, name, params = '') => withToken(`/api/events/${eventId}/export/${name}${params}`),
  sessionZipUrl: (sessionId, include) => withToken(`/api/sessions/${sessionId}/zip${include ? `?include=${include}` : ''}`),
};

function withToken(url) {
  if (!store.token) return url;
  return url + (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(store.token)}`;
}

// Uploads a File with progress using XHR (streams the raw body; no multipart).
export function uploadFile(url, file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total, e.loaded); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error || `Erro ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Falha de rede durante o envio'));
    xhr.onabort = () => reject(new ApiError(0, 'Envio cancelado'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}
