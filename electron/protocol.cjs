const path = require('node:path');
const { pathToFileURL } = require('node:url');

const GAME_URL = 'sangota://game/index.html';
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

function resolveAsset(root, address) {
  try {
    const url = new URL(address);
    if (url.protocol !== 'sangota:' || url.host !== 'game' || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (/[\\\0]/.test(pathname)) return null;
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return file;
  } catch {
    return null;
  }
}

function createAssetHandler(root, fetchFile) {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const file = resolveAsset(root, request.url);
    if (!file) return new Response(null, { status: 403 });
    try {
      const response = await fetchFile(pathToFileURL(file).href, {
        method: request.method,
        headers: request.headers,
      });
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
}

function isGamePage(address, devUrl) {
  try {
    const url = new URL(address);
    const expected = new URL(devUrl || GAME_URL);
    return url.protocol === expected.protocol && url.host === expected.host &&
      !url.username && !url.password && (url.pathname === '/' || url.pathname === '/index.html');
  } catch {
    return false;
  }
}

function isProjectLink(address) {
  // This is the only external link in the game. Never pass arbitrary schemes
  // or URLs supplied by a renderer to the operating system.
  return address === 'https://github.com/zhy0216/sangota';
}

module.exports = { GAME_URL, resolveAsset, createAssetHandler, isGamePage, isProjectLink };
