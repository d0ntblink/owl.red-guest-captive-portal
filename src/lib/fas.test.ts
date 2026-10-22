import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FasService } from './fas.js';

const key = 'a'.repeat(64);
const hid = 'b'.repeat(64);
const handoff = Buffer.from(`hid=${hid}, gatewayname=owl.red guest, clientip=198.18.30.2, clientmac=02:6f:77:30:02:04`).toString('base64');

test('consent queues the native FAS record; only a native acknowledgment reports authentication', async () => {
  const service = new FasService(key, 'owl.red guest');
  const token = await service.offer(handoff, 'browser-one');
  const rhid = await service.accept(token, 'browser-one');
  assert.equal(rhid, createHash('sha256').update(hid + key).digest('hex'));
  assert.equal(service.status(rhid), 'pending');
  const parameters = new URLSearchParams({ auth_get: 'view', gatewayhash: service.gatewayHash, payload: Buffer.from('none').toString('base64') });
  const queued = service.authmon(parameters, true);
  assert.equal(decodeURIComponent(queued.slice(2)), `${rhid} 120 0 0 0 0 dGVybXM9YWNjZXB0ZWQ=`);
  parameters.set('payload', Buffer.from(`* ${rhid}\n`).toString('base64'));
  assert.equal(service.authmon(parameters, true), 'ack');
  assert.equal(service.status(rhid), 'authenticated');
});

test('another browser cannot use a consent offer', async () => {
  const service = new FasService(key, 'owl.red guest');
  await assert.rejects(service.accept(await service.offer(handoff, 'browser-one'), 'browser-two'));
});

test('tampered offers are rejected', async () => {
  const service = new FasService(key, 'owl.red guest');
  const token = await service.offer(handoff, 'browser-one');
  await assert.rejects(service.accept(token.slice(0, -10) + 'tampered123', 'browser-one'));
});

test('unknown gateways and malformed or duplicate fields are rejected', async () => {
  const service = new FasService(key, 'other gateway');
  await assert.rejects(service.offer(handoff, 'browser-one'));
  await assert.rejects(service.offer(Buffer.from(`hid=${hid}, hid=${hid}`).toString('base64'), 'browser-one'));
});

test('the public request path cannot read, clear or acknowledge the gateway queue', () => {
  const service = new FasService(key, 'owl.red guest');
  for (const method of ['view', 'clear', 'deauthed', 'custom']) {
    assert.throws(() => service.authmon(new URLSearchParams({ auth_get: method, gatewayhash: service.gatewayHash }), false));
  }
});

test('restarting the FAS loses pending consent and fails closed', async () => {
  const service = new FasService(key, 'owl.red guest');
  const rhid = await service.accept(await service.offer(handoff, 'browser-one'), 'browser-one');
  assert.equal(new FasService(key, 'owl.red guest').status(rhid), 'expired');
});

test('production HTTP consent works with cookies, rejects a foreign origin, and does not grant itself access', { skip: !existsSync('dist/server/entry.mjs'), timeout: 15000 }, async () => {
  const reserved = createServer();
  reserved.listen(0, '127.0.0.1');
  await once(reserved, 'listening');
  const address = reserved.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => reserved.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), 'owl-portal-http-'));
  const keyFile = join(directory, 'fas.key');
  writeFileSync(keyFile, key, { mode: 0o600 });
  const server = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PORTAL_ORIGIN: origin, FAS_KEY_FILE: keyFile, TRUST_AUTHMON_PROXY: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', data => {
    diagnostics += String(data).split('\n').filter(line => line.includes('Portal consent rejected')).join('\n');
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('HTTP server readiness timed out')), 8000);
      server.stdout.on('data', data => {
        if (String(data).includes('Server listening')) { clearTimeout(deadline); resolve(); }
      });
      server.once('exit', () => { clearTimeout(deadline); reject(new Error('HTTP server exited early')); });
    });
    const response = await fetch(`${origin}/?fas=${encodeURIComponent(handoff)}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const offer = html.match(/name="offer" value="([^"]+)"/)?.[1];
    assert(offer);
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const consent = await fetch(`${origin}/`, { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ offer, consent: 'yes' }) });
    const rejection = (await consent.text()).match(/<h1[^>]*>([^<]*)/)?.[1] ?? 'framework response';
    assert.equal(consent.status, 303, rejection + diagnostics);
    assert.equal(consent.headers.get('location'), '/?page=status');
    const foreign = await fetch(`${origin}/`, { method: 'POST', headers: { Origin: 'https://example.org', 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ offer, consent: 'yes' }) });
    assert.equal(foreign.status, 403);
    const untrusted = await fetch(`${origin}/?auth_get=clear`, { headers: { 'X-Owl-Authmon': '1' } });
    assert.equal(untrusted.status, 403);
  } finally {
    const closed = once(server, 'close');
    server.kill('SIGTERM');
    await closed;
    rmSync(directory, { recursive: true, force: true });
  }
});