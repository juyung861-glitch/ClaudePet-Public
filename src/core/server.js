'use strict';
// 127.0.0.1 전용 작은 HTTP 서버: 훅(hook.js)과 CLI(cli.js)가 펫에게 말을 거는 통로
const http = require('http');

const HEADER = 'x-claude-pet';
const MAX_BODY = 64 * 1024;

/**
 * handlers: { onEvent(evt) -> any, onControl(cmd) -> Promise<any>|any, info() -> object }
 */
function createServer(handlers) {
  const server = http.createServer((req, res) => {
    const send = (code, body) => {
      const data = JSON.stringify(body);
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(data);
    };

    // 브라우저 페이지가 몰래 보내는 요청(CSRF) 차단: 커스텀 헤더 필수, CORS 응답 안 함
    if (req.method === 'OPTIONS') return send(405, { ok: false });
    if (req.headers.origin) return send(403, { ok: false, error: 'origin not allowed' });

    const url = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && url === '/health') {
      return send(200, { ok: true, app: 'claude-pet', ...(handlers.info ? handlers.info() : {}) });
    }
    if (req.method !== 'POST' || (url !== '/event' && url !== '/control')) return send(404, { ok: false });
    if (req.headers[HEADER] !== '1') return send(403, { ok: false, error: 'missing header' });

    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(413, { ok: false });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return send(400, { ok: false, error: 'bad json' });
      }
      try {
        const result = url === '/event' ? handlers.onEvent(body) : await handlers.onControl(body);
        send(200, { ok: true, ...(result && typeof result === 'object' ? result : {}) });
      } catch (e) {
        send(500, { ok: false, error: String(e && e.message || e) });
      }
    });
  });
  server.keepAliveTimeout = 1000;
  return server;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (e) => { server.off('listening', onListening); reject(e); };
    const onListening = () => { server.off('error', onError); resolve(server.address()); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

module.exports = { createServer, listen, HEADER };
