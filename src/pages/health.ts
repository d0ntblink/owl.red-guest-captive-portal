import type { APIRoute } from 'astro';

export const GET: APIRoute = () => new Response('ok', { headers: { 'Content-Type': 'text/plain' } });