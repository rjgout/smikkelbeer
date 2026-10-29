import { it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from '../src/lib/client';
afterEach(() => vi.unstubAllGlobals());
it.each([502, 504, 524])(
  'preserves HTTP %i when a proxy returns HTML and never exposes its contents',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>private token=secret</html>', {
            status,
            headers: { 'content-type': 'text/html', 'cf-ray': 'abc123-AMS' },
          }),
      ),
    );
    try {
      await api('menu/sync', {});
      throw new Error('should reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect(e).toMatchObject({ httpStatus: status, requestId: 'abc123-AMS' });
      expect((e as Error).message).toContain('HTTP ' + status);
      expect((e as Error).message).not.toMatch(/private|token|secret|expected pattern/);
    }
  },
);
it('handles malformed JSON and disconnected requests with Dutch diagnostics', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('<html>not json</html>', { headers: { 'content-type': 'application/json' } }),
    ),
  );
  await expect(api('menu/sync/status')).rejects.toMatchObject({ code: 'INVALID_JSON' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('private network information');
    }),
  );
  await expect(api('menu/sync/status')).rejects.toMatchObject({
    code: 'NETWORK',
    httpStatus: 0,
    message: expect.stringContaining('achtergrondtaak'),
  });
});
it('requests JSON explicitly and keeps structured Dutch API errors', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify({ message: 'Wacht één minuut.', code: 'SYNC_COOLDOWN' }), {
        status: 429,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(api('menu/sync', {})).rejects.toMatchObject({
    httpStatus: 429,
    code: 'SYNC_COOLDOWN',
    message: 'Wacht één minuut.',
  });
  expect(fetch.mock.calls[0][1]).toMatchObject({
    headers: { Accept: 'application/json', 'content-type': 'application/json' },
  });
});
