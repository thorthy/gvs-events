// Minimal HTTP router with path parameters (":id") and wildcard tails ("*").
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const regexSrc = pattern
      .split('/')
      .map((seg) => {
        if (seg === '*') { keys.push('rest'); return '(.*)'; }
        if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method: method.toUpperCase(), regex: new RegExp(`^${regexSrc}/?$`), keys, handler, pattern });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method.toUpperCase()) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params, pattern: route.pattern };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}
