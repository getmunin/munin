import http from 'node:http';

const PORT = Number(process.env.PROXY_PORT ?? 8088);
const WEB = { host: '127.0.0.1', port: Number(process.env.WEB_PORT ?? 3000) };
const BACKEND = { host: '127.0.0.1', port: Number(process.env.BACKEND_PORT ?? 3001) };

// Paths the backend owns; everything else is the Next web app. claude.ai
// requires OAuth discovery, the /mcp endpoint, and the login/consent pages
// to share one https origin, which is why a path router sits in front.
const BACKEND_PREFIXES = ['/mcp', '/auth', '/.well-known', '/v1', '/icon.png', '/widget.js', '/tracker.js'];

function pick(url) {
  return BACKEND_PREFIXES.some((p) => url === p || url.startsWith(p + '/') || url.startsWith(p + '?'))
    ? BACKEND
    : WEB;
}

function forwardHeaders(req) {
  const h = { ...req.headers };
  h['x-forwarded-proto'] = 'https';
  h['x-forwarded-host'] = req.headers.host ?? '';
  h['x-forwarded-for'] = req.socket.remoteAddress ?? '';
  return h;
}

const server = http.createServer((req, res) => {
  const target = pick(req.url);
  const proxyReq = http.request(
    { host: target.host, port: target.port, method: req.method, path: req.url, headers: forwardHeaders(req) },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`proxy error to :${target.port} — ${err.message}`);
  });
  req.pipe(proxyReq);
});

// Proxy WebSocket upgrades (Next HMR on web, realtime on backend).
server.on('upgrade', (req, socket, head) => {
  const target = pick(req.url);
  const proxyReq = http.request({
    host: target.host,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: forwardHeaders(req),
  });
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') +
        '\r\n\r\n',
    );
    if (proxyHead && proxyHead.length) proxySocket.unshift(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
  });
  proxyReq.on('error', () => socket.destroy());
  if (head && head.length) proxyReq.write(head);
  proxyReq.end();
});

server.listen(PORT, () =>
  console.log(`claude-connector-proxy on :${PORT} → web :${WEB.port} / backend :${BACKEND.port}`),
);
