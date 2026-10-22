import { defineMiddleware } from 'astro:middleware';
import { getFas } from './lib/runtime.js';

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.searchParams.has('auth_get')) {
    try {
      const trusted = process.env.TRUST_AUTHMON_PROXY === 'true' && context.request.headers.get('x-owl-authmon') === '1';
      return new Response(getFas().authmon(context.url.searchParams, trusted), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch {
      return new Response('Gateway access denied', { status: 403 });
    }
  }
  const response = await next();
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  return response;
});