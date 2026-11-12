// A tiny stand-in for Supabase Auth, ONLY for local browser tests/screenshots of the
// dashboard when no Supabase project is available. Never used in production.
// Accepts owner@example.com / demo-pass.
import { createServer } from 'node:http';

const USER = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'owner@example.com',
  app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const TOKEN = 'fake-access-token';
const port = Number(process.env.PORT || 54321);

createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/auth/v1/token')) {
      const { email, password } = JSON.parse(body || '{}');
      if (email !== USER.email || password !== 'demo-pass') return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return send(200, { access_token: TOKEN, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'fake-refresh', user: USER });
    }
    if (req.url.startsWith('/auth/v1/user')) {
      return req.headers.authorization === `Bearer ${TOKEN}` ? send(200, USER) : send(401, { msg: 'invalid token' });
    }
    if (req.url.startsWith('/auth/v1/logout')) return send(204, {});
    send(404, {});
  });
}).listen(port, () => console.log(`fake supabase auth on :${port}`));
