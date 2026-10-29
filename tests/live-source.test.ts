import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
// Explicit read-only contract check. Never used to populate the application.
it.skipIf(process.env.SMIKKEL_LIVE_SOURCE !== '1')(
  'validates every currently available official source product and its options',
  async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'smikkel-source-'));
    process.env.DATA_DIR = directory;
    const { parseMenu, parseOptions } = await import('../src/lib/server/menu');
    const { db } = await import('../src/lib/server/db');
    const read = (path: string) =>
      execFileSync(
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
    try {
      const products = parseMenu(read('/'));
      expect(products.length).toBeGreaterThan(0);
      let checked = 0;
      for (const product of products) {
        if (!product.available) continue;
        await new Promise((r) => setTimeout(r, 1100));
        product.options = parseOptions(read('/order/product/add/' + product.id), product.id);
        checked++;
      }
      console.log(
        'Official source products: ' +
          products.length +
          '; available option forms verified: ' +
          checked,
      );
      expect(checked).toBeGreaterThan(0);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  600000,
);
