import { createHash, hkdfSync, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { LRUCache } from 'lru-cache';
import { z } from 'zod';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const offerSchema = z.object({
  hid: hashSchema,
  gatewayname: z.string().min(1).max(256),
  clientip: z.ipv4(),
  clientmac: z.string().regex(/^(?:[a-fA-F0-9]{2}:){5}[a-fA-F0-9]{2}$/),
});

export class FasService {
  private readonly signingKey: Uint8Array;
  private readonly pending = new LRUCache<string, { gatewayHash: string; line: string }>({ max: 256, ttl: 30_000 });
  private readonly completed = new LRUCache<string, string>({ max: 256, ttl: 300_000 });
  readonly gatewayHash: string;

  constructor(private readonly key: string, private readonly gatewayName: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('A private 256-bit FAS key is required');
    this.gatewayHash = digest(gatewayName);
    this.signingKey = new Uint8Array(hkdfSync('sha256', key, '', 'owl.red portal consent', 32));
  }

  async offer(encoded: string, nonce: string): Promise<string> {
    if (encoded.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid portal handoff');
    const fields: Record<string, string> = {};
    for (const field of Buffer.from(encoded, 'base64').toString('utf8').split(', ')) {
      const separator = field.indexOf('=');
      if (separator < 1) continue;
      const name = field.slice(0, separator);
      if (Object.hasOwn(fields, name)) throw new Error('Duplicate handoff field');
      fields[name] = field.slice(separator + 1);
    }
    const offer = offerSchema.parse(fields);
    const name = decodeURIComponent(offer.gatewayname).trim();
    const prefix = this.gatewayName + ' Node:';
    if (name !== this.gatewayName && !(name.startsWith(prefix) && /^[a-f0-9]{12}$/i.test(name.slice(prefix.length)))) throw new Error('Unknown gateway');
    return new SignJWT({ ...offer, nonce: digest(nonce) })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('owl.red guest portal')
      .setAudience(this.gatewayHash)
      .setIssuedAt().setExpirationTime('5m').setJti(randomUUID())
      .sign(this.signingKey);
  }

  async accept(token: string, nonce: string): Promise<string> {
    const { payload } = await jwtVerify(token, this.signingKey, {
      algorithms: ['HS256'], issuer: 'owl.red guest portal', audience: this.gatewayHash,
    });
    const offer = offerSchema.parse(payload);
    if (payload.nonce !== digest(nonce)) throw new Error('Consent belongs to another browser');
    const rhid = digest(offer.hid + this.key);
    if (!this.completed.has(rhid) && !this.pending.has(rhid)) {
      this.pending.set(rhid, { gatewayHash: digest(offer.gatewayname.trim()), line: `${rhid} 120 0 0 0 0 ${Buffer.from('terms=accepted').toString('base64')}` });
    }
    return rhid;
  }

  status(rhid: string): 'pending' | 'authenticated' | 'expired' {
    hashSchema.parse(rhid);
    if (this.completed.has(rhid)) return 'authenticated';
    return this.pending.has(rhid) ? 'pending' : 'expired';
  }

  authmon(parameters: URLSearchParams, trustedGateway: boolean): string {
    const gatewayHash = parameters.get('gatewayhash') ?? '';
    if (!trustedGateway || !hashSchema.safeParse(gatewayHash).success) throw new Error('Gateway access denied');
    const method = parameters.get('auth_get');
    if (method === 'clear') {
      for (const [rhid, request] of this.pending) if (request.gatewayHash === gatewayHash) this.pending.delete(rhid);
      for (const [rhid, gateway] of this.completed) if (gateway === gatewayHash) this.completed.delete(rhid);
      return '';
    }
    if (method === 'deauthed' || method === 'custom') return 'ack';
    if (method !== 'view') throw new Error('Unsupported Authmon method');
    const encoded = parameters.get('payload') ?? '';
    if (encoded.length > 16384 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid acknowledgment');
    const acknowledgment = Buffer.from(encoded, 'base64').toString('utf8');
    if (acknowledgment !== 'none') {
      const clients = acknowledgment.trim().replace(/^\*\s*/, '').split(/\s+/).filter(Boolean);
      if (!clients.every(value => hashSchema.safeParse(value).success)) throw new Error('Invalid acknowledgment');
      for (const rhid of clients) {
        if (this.pending.get(rhid)?.gatewayHash === gatewayHash) {
          this.pending.delete(rhid);
          this.completed.set(rhid, gatewayHash);
        }
      }
      return 'ack';
    }
    return ['*', ...Array.from(this.pending.values()).filter(request => request.gatewayHash === gatewayHash).map(request => encodeURIComponent(request.line))].join(' ');
  }
}