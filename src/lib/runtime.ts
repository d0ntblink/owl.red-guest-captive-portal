import { readFileSync } from 'node:fs';
import { FasService } from './fas.js';

let service: FasService | undefined;

export function getFas(): FasService {
  if (!service) {
    const keyPath = process.env.FAS_KEY_FILE;
    if (!keyPath) throw new Error('A private runtime FAS key file is required');
    service = new FasService(readFileSync(keyPath, 'utf8').trim(), process.env.GATEWAY_NAME ?? 'owl.red guest');
  }
  return service;
}

export function portalOrigin(): string {
  const configured = process.env.PORTAL_ORIGIN ?? 'http://127.0.0.1:4321';
  const origin = new URL(configured);
  if (origin.origin !== configured || (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname))) {
    throw new Error('A canonical HTTPS portal origin is required');
  }
  return origin.origin;
}