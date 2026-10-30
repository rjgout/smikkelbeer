import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
// Explicit read-only contract/worker test. Never uses the live application's DB.
it.skipIf(process.env.SMIKKEL_LIVE_SOURCE !== '1')(
  'validates and atomically publishes every available official source option through a background job',
  async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'smikkel-source-'));
    process.env.DATA_DIR = directory;
    const { processMenuSyncJobs } = await import('../src/lib/server/menu');
    const { enqueueMenuSync, menuSyncStatus } = await import('../src/lib/server/menu-jobs');
    const { defaults, saveSettings } = await import('../src/lib/server/config');
    const { db, one } = await import('../src/lib/server/db');
    try {
      saveSettings(
        { ...structuredClone(defaults), scrapingApproved: true, weekdays: [] },
        'source-probe',
      );
      const { job } = enqueueMenuSync('source-probe');
      const start = Date.now();
      await processMenuSyncJobs({
        read: async (path, signal) => {
          signal.throwIfAborted();
          if (path !== '/' && !/^\/order\/product\/add\/\d+$/.test(path))
            throw new Error('Invalid source path');
          return execFileSync(
            'curl',
            [
              '--fail',
              '--silent',
              '--show-error',
              '--location',
              '--max-redirs',
              '0',
              '--max-time',
              '20',
              '--max-filesize',
              '2000000',
              'https://www.hetcentrummarum.nl' + path,
            ],
            { encoding: 'utf8', maxBuffer: 2000000 },
          );
        },
        delay: (ms, signal) => sleep(ms, undefined, { signal }),
      });
      const status = menuSyncStatus(job.id).job!;
      expect(status.error).toBeNull();
      expect(status.status).toBe('succeeded');
      expect(status.processed).toBe(status.total);
      expect(status.total).toBeGreaterThan(0);
      const catalog = JSON.parse(
        one('SELECT products FROM syncs WHERE id=?', status.syncId).products,
      );
      const evidence = {
        status: status.status,
        products: catalog.length,
        available: catalog.filter((p: any) => p.available).length,
        elapsedMs: Date.now() - start,
      };
      console.info('Live source evidence:', JSON.stringify(evidence));
      expect(catalog.length).toBe(status.total);
      expect(one('SELECT count(*) count FROM outbox').count).toBe(0);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  600000,
);
