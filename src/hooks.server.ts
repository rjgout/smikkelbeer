import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import { startScheduler } from '#lib/server/scheduler';
import { one } from '#lib/server/db';
import { settings } from '#lib/server/config';
if (!building) startScheduler();
export const handle: Handle = async ({ event, resolve }) => {
  if (!dev && !building) {
    const expected = new URL(settings().publicUrl).origin;
    if (
      event.url.protocol !== 'https:' ||
      (one('SELECT id FROM settings WHERE id=1') && event.url.origin !== expected)
    ) {
      if (event.url.pathname !== '/api/health') error(400, 'Gebruik de geconfigureerde HTTPS-URL');
    }
  }
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
    if (event.request.headers.get('origin') !== event.url.origin)
      error(403, 'Ongeldige verzoekherkomst');
    if (!event.request.headers.get('content-type')?.startsWith('application/json'))
      error(415, 'JSON vereist');
    const length = Number(event.request.headers.get('content-length') || 0);
    if (length > 65536) error(413, 'Verzoek te groot');
  }
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  response.headers.set('Cache-Control', 'no-store');
  if (!dev) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
};
export const handleError = () => ({
  message: 'Er ging iets mis. Controleer diagnostiek of probeer het later opnieuw.',
});
