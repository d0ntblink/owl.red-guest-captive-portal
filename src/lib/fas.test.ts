import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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