import { load } from 'cheerio';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { all, one, run, audit, transaction } from './db';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  MenuSyncError,
  enqueueMenuSync,
  assertMenuLease,
  finishMenuFailure,
  recoverMenuSyncJobs,
  claimMenuSyncJob,
  renewMenuLease,
  menuSyncStatus,
} from './menu-jobs';
import { hash } from './crypto';
import { settings } from './config';
export type Option = {
  id: string;
  name: string;
  cents: number;
  group: string;
  max: number;
  min?: number;
  groupLabel?: string;
};
export type Product = {
  id: string;
  name: string;
  category: 'Patat' | 'Snacks' | 'Overige';
  cents: number;
  available: boolean;
  options: Option[];
};
export function cents(raw: string | undefined) {
  if (!raw || !/^\d{1,4}\.\d{2}$/.test(raw)) throw new Error('Prijsformaat gewijzigd');
  const [e, c] = raw.split('.');
  return Number(e) * 100 + Number(c);
}
export function parseMenu(html: string): Product[] {
  const $ = load(html);
  const products: Product[] = [];
  $('.dish[id^="product"]').each((_, el) => {
    const p = $(el);
    const id = p.attr('data-productid'),
      name = p.attr('data-productnaam')?.trim(),
      category = p.attr('data-productcategorie')?.trim();
    if (!id || !/^\d+$/.test(id) || !name || !category)
      throw new Error('Bronstructuur gewijzigd: ontbrekende productgegevens');
    const deposit = cents(p.attr('data-deposit') || '0.00'),
      fee = cents(p.attr('data-supfee') || '0.00');
    products.push({
      id,
      name,
      category: /patat|friet/i.test(category)
        ? 'Patat'
        : /snack|vegetarisch/i.test(category)
          ? 'Snacks'
          : 'Overige',
      cents: cents(p.attr('data-prijs')) + deposit + fee,
      available: p.find('button.sold-out,button[disabled]').length === 0,
      options: [],
    });
  });
  if (
    !products.length ||
    products.length > 500 ||
    new Set(products.map((p) => p.id)).size !== products.length
  )
    throw new Error('Geen betrouwbare unieke menukaart');
  return products.sort((a, b) => a.id.localeCompare(b.id));
}
export function parseOptions(html: string, productId: string): Option[] {
  const $ = load(html);
  if (!$('#addProductForm').length) throw new Error('Optiestructuur gewijzigd');
  const options: Option[] = [];
  const inputs = $('#addProductForm input.vreterijOptie');
  const selects = $('#addProductForm select.vreterijSelectOptie');
  if ($('#addProductForm select').length !== selects.length)
    throw new Error('Onbekende verplichte variant; bronadapter bijwerken');
  const occurrences = new Map<string, number>();
  selects.each((_, el) => {
    const select = $(el);
    if (
      select.attr('data-productid') !== productId ||
      select.attr('multiple') !== undefined ||
      select.attr('disabled') !== undefined
    )
      throw new Error('Onbekende verplichte variant');
    const sourceOptions = select.find('option.vreterijOptie');
    if (!sourceOptions.length || sourceOptions.length !== select.find('option').length)
      throw new Error('Verplichte varianten ontbreken');
    const sourceIds = sourceOptions
      .toArray()
      .map((o) => $(o).attr('data-id') || '')
      .sort();
    const signature = 'required-' + hash(sourceIds.join(':')).slice(0, 16);
    const occurrence = occurrences.get(signature) || 0;
    occurrences.set(signature, occurrence + 1);
    const group = signature + (occurrence ? '-' + (occurrence + 1) : '');
    const sourceLabel =
      select.parent().prev('.form-group-label').find('label').text().trim() || 'Kies een variant';
    const groupLabel = sourceLabel + (occurrence ? ' (' + (occurrence + 1) + ')' : '');
    sourceOptions.each((_, option) => {
      const o = $(option),
        id = o.attr('data-id'),
        name = o.attr('data-naam');
      if (!id || !name || o.attr('disabled') !== undefined)
        throw new Error('Onbekende verplichte optie');
      options.push({
        id: group + ':' + id,
        name,
        group,
        groupLabel,
        min: 1,
        max: 1,
        cents:
          cents(o.attr('data-prijs')) +
          cents(o.attr('data-deposit') || '0.00') +
          cents(o.attr('data-supfee') || '0.00'),
      });
    });
  });
  inputs.each((_, el) => {
    const p = $(el);
    const id = p.attr('data-id'),
      name = p.attr('data-naam'),
      group = p.attr('data-group');
    if (
      !id ||
      !name ||
      !group ||
      p.attr('data-productid') !== productId ||
      !['checkbox', 'radio'].includes(p.attr('type') || '')
    )
      throw new Error('Onbekende optie');
    if (p.attr('required') !== undefined || p.attr('data-min'))
      throw new Error('Verplichte opties vereisen adaptercontrole');
    const rawMax = p.attr('data-max');
    const max = p.attr('type') === 'radio' ? 1 : rawMax ? Number(rawMax) : 99;
    if (!Number.isInteger(max) || max < 1 || max > 99) throw new Error('Onbekende optielimiet');
    options.push({
      id: group + ':' + id,
      name,
      group,
      max,
      cents:
        cents(p.attr('data-prijs')) +
        cents(p.attr('data-deposit') || '0.00') +
        cents(p.attr('data-supfee') || '0.00'),
    });
  });
  if (new Set(options.map((o) => o.id)).size !== options.length) throw new Error('Dubbele opties');
  return options.sort((a, b) => a.id.localeCompare(b.id));
}
const source = 'https://www.hetcentrummarum.nl';
async function fetchSource(path: string, signal: AbortSignal) {
  if (path !== '/' && !/^\/order\/product\/add\/\d+$/.test(path))
    throw new Error('Bronpad niet toegestaan');
  const response = await fetch(source + path, {
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    headers: {
      'User-Agent': 'Smikkelbeer/0.1 (low-frequency menu synchronization)',
      Accept: 'text/html',
    },
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html'))
    throw new MenuSyncError(
      'SOURCE_HTTP',
      'De cafetaria geeft geen bruikbaar HTML-antwoord (HTTP ' +
        response.status +
        '). Er is niets gepubliceerd.',
      502,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Lege bron');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error('Bron te groot');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function digest(products: Product[]) {
  return hash(JSON.stringify(products));
}
export type MenuSource = {
  read: (path: string, signal: AbortSignal) => Promise<string>;
  delay: (ms: number, signal: AbortSignal) => Promise<unknown>;
};
const defaultSource: MenuSource = {
  read: fetchSource,
  delay: (ms, signal) => sleep(ms, undefined, { signal }),
};
let processingMenu = false;
let activeMenu: { id: string; owner: string; controller: AbortController } | undefined;
let menuTimer: ReturnType<typeof setInterval> | undefined;
let menuStopping = false;
function safeSyncFailure(error: unknown, signal: AbortSignal) {
  if (error instanceof MenuSyncError) return error;
  if (signal.aborted)
    return new MenuSyncError(
      'PROCESS_INTERRUPTED',
      'De synchronisatie is onderbroken. De vorige geldige momentopnamen zijn bewaard.',
    );
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
    return new MenuSyncError(
      'SOURCE_TIMEOUT',
      'De cafetaria reageerde niet binnen de toegestane tijd. Er is geen onvolledige menukaart gepubliceerd.',
      502,
    );
  return new MenuSyncError(
    'SOURCE_UNAVAILABLE',
    'De bron kon niet veilig worden gecontroleerd. Controleer de verbinding en bronstructuur; de vorige momentopnamen zijn bewaard.',
    502,
  );
}
function parseSource<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new MenuSyncError(
      'SOURCE_STRUCTURE',
      'De product- of optiestructuur van de cafetaria is gewijzigd of ongeldig. Er is niets gepubliceerd.',
      502,
    );
  }
}
export async function processMenuSyncJobs(source: MenuSource = defaultSource) {
  if (processingMenu || menuStopping) return;
  recoverMenuSyncJobs();
  const job = claimMenuSyncJob();
  if (!job) return;
  processingMenu = true;
  const controller = new AbortController(),
    owner = job.lease_owner;
  activeMenu = { id: job.id, owner, controller };
  const heartbeat = setInterval(() => {
    try {
      if (!renewMenuLease(job.id, owner)) controller.abort();
    } catch {
      controller.abort();
    }
  }, 10000);
  heartbeat.unref();
  try {
    const check = () => {
      controller.signal.throwIfAborted();
      assertMenuLease(job.id, owner);
      if (!settings().scrapingApproved)
        throw new MenuSyncError(
          'SCRAPING_DISABLED',
          'Synchronisatie gestopt: brongebruik is uitgeschakeld in Instellingen.',
        );
    };
    check();
    const html = await source.read('/', controller.signal);
    check();
    const catalog = parseSource(() => parseMenu(html));
    run(
      "UPDATE menu_sync_jobs SET total=?,phase='options',updated=? WHERE id=? AND lease_owner=?",
      catalog.length,
      Date.now(),
      job.id,
      owner,
    );
    for (const product of catalog) {
      check();
      run(
        'UPDATE menu_sync_jobs SET current_product_id=? WHERE id=? AND lease_owner=?',
        product.id,
        job.id,
        owner,
      );
      if (product.available) {
        await source.delay(Math.max(job.delay_ms, settings().syncIntervalMs), controller.signal);
        check();
        const html = await source.read('/order/product/add/' + product.id, controller.signal);
        check();
        product.options = parseSource(() => parseOptions(html, product.id));
      }
      check();
      run(
        'UPDATE menu_sync_jobs SET processed=processed+1,updated=? WHERE id=? AND lease_owner=?',
        Date.now(),
        job.id,
        owner,
      );
    }
    const fingerprint = digest(catalog),
      syncId = randomUUID();
    transaction(() => {
      check();
      const progress = one('SELECT processed,total FROM menu_sync_jobs WHERE id=?', job.id);
      if (progress.processed !== catalog.length || progress.total !== catalog.length)
        throw new MenuSyncError(
          'INCOMPLETE',
          'De broncontrole is onvolledig. Er is niets gepubliceerd.',
        );
      run(
        'INSERT INTO syncs VALUES (?,?,1,?,?,NULL)',
        syncId,
        Date.now(),
        fingerprint,
        JSON.stringify(catalog),
      );
      run(
        "UPDATE menu_sync_jobs SET sync_id=?,phase='applying',updated=? WHERE id=? AND lease_owner=?",
        syncId,
        Date.now(),
        job.id,
        owner,
      );
    });
    // Dependent HTTP actions run after publication, independently of the browser connection.
    let roundId: string | null = null;
    if (job.purpose !== 'menu') {
      check();
      const admin = one(
        'SELECT r.permissions FROM admins a JOIN roles r ON r.id=a.role_id WHERE a.id=? AND a.active=1',
        job.actor,
      );
      if (!admin || !JSON.parse(admin.permissions).some((p: string) => p === '*' || p === 'rounds'))
        throw new MenuSyncError(
          'PERMISSION_REVOKED',
          'De menukaart is gecontroleerd, maar de beheerrechten voor de ronde zijn ingetrokken.',
        );
      if ((job.test === 1) !== settings().testMode)
        throw new MenuSyncError(
          'MODE_CHANGED',
          'De menukaart is gecontroleerd, maar de testmodus is gewijzigd. Start de ronde-opdracht opnieuw.',
        );
      const payload = JSON.parse(job.payload);
      const orders = await import('./orders');
      check();
      transaction(() => {
        check();
        if (job.purpose === 'round.create')
          roundId = orders.createRoundFromMenu(payload, job.actor, {
            products: catalog,
            digest: fingerprint,
          });
        else {
          roundId = payload.roundId;
          orders.queueValidatedRound(roundId!, fingerprint);
        }
        run(
          'UPDATE menu_sync_jobs SET result_round_id=? WHERE id=? AND lease_owner=?',
          roundId,
          job.id,
          owner,
        );
      });
    }
    transaction(() => {
      check();
      run(
        "UPDATE menu_sync_jobs SET status='succeeded',phase='complete',finished=?,updated=?,lease_owner=NULL,lease_until=NULL,current_product_id=NULL,result_round_id=? WHERE id=? AND lease_owner=?",
        Date.now(),
        Date.now(),
        roundId,
        job.id,
        owner,
      );
      audit(job.actor, 'menu.sync', job.id, { count: catalog.length, purpose: job.purpose });
    });
  } catch (error) {
    const published = one('SELECT sync_id,purpose FROM menu_sync_jobs WHERE id=?', job.id);
    const failure =
      published?.sync_id &&
      published.purpose !== 'menu' &&
      !(error instanceof MenuSyncError) &&
      !controller.signal.aborted
        ? new MenuSyncError(
            'ROUND_ACTION_FAILED',
            'De menukaart is volledig gecontroleerd, maar de ronde kon niet worden verwerkt. Controleer de planning en rondestatus voordat je opnieuw begint.',
          )
        : safeSyncFailure(error, controller.signal);
    finishMenuFailure(
      job.id,
      owner,
      failure.code,
      failure.message,
      ['PROCESS_INTERRUPTED', 'LEASE_LOST'].includes(failure.code),
    );
  } finally {
    clearInterval(heartbeat);
    activeMenu = undefined;
    processingMenu = false;
  }
}
export function stopMenuSyncWorker() {
  menuStopping = true;
  if (menuTimer) clearInterval(menuTimer);
  menuTimer = undefined;
  activeMenu?.controller.abort();
}
export function startMenuSyncWorker() {
  if (menuTimer || menuStopping || process.env.BUILDING === '1') return;
  menuTimer = setInterval(
    () =>
      void processMenuSyncJobs().catch(() => {
        try {
          audit('system', 'menu.worker_error');
        } catch {
          /* The healthcheck reports database failures; preserve the lease for recovery. */
        }
      }),
    1000,
  );
  menuTimer.unref();
  process.once('SIGTERM', stopMenuSyncWorker);
  process.once('SIGINT', stopMenuSyncWorker);
}
export async function syncMenu(actor = 'system') {
  if (menuStopping)
    throw new MenuSyncError(
      'PROCESS_INTERRUPTED',
      'De server wordt gestopt. Start de synchronisatie opnieuw zodra de server beschikbaar is.',
    );
  const { job } = enqueueMenuSync(actor, 'menu', null, false);
  startMenuSyncWorker();
  for (;;) {
    const current = menuSyncStatus(job.id).job!;
    if (current.status === 'succeeded') {
      const row = one('SELECT * FROM syncs WHERE id=? AND success=1', current.syncId);
      if (!row)
        throw new MenuSyncError(
          'RESULT_MISSING',
          'De gecontroleerde menukaart is niet meer beschikbaar. Synchroniseer opnieuw.',
        );
      return { products: JSON.parse(row.products) as Product[], digest: row.digest };
    }
    if (['failed', 'interrupted'].includes(current.status))
      throw new MenuSyncError(
        current.error?.code || 'SYNC_FAILED',
        current.error?.message || 'Synchronisatie mislukt.',
      );
    await sleep(250);
  }
}
export const MENU_MAX_AGE_MS = 30 * 60000;
export function latestMenu() {
  const row = one('SELECT * FROM syncs ORDER BY at DESC,rowid DESC LIMIT 1');
  if (!row || !row.success || row.at > Date.now() || Date.now() - row.at > MENU_MAX_AGE_MS)
    throw new Error('Menukaart ontbreekt, is verouderd of synchronisatie mislukt');
  let products: Product[];
  try {
    products = JSON.parse(row.products);
    if (!Array.isArray(products) || !products.length || digest(products) !== row.digest)
      throw new Error('Invalid snapshot');
  } catch {
    throw new MenuSyncError(
      'SNAPSHOT_INTEGRITY',
      'De integriteit van de opgeslagen menukaart kon niet worden bevestigd. Voer een volledige broncontrole uit.',
    );
  }
  return { products, digest: row.digest, at: row.at };
}
export const lineInput = z.object({
  productId: z.string().regex(/^\d+$/),
  optionIds: z.array(z.string().max(100)).max(30),
  quantity: z.number().int().min(1).max(30),
  note: z.string().max(200),
});
export type OrderLine = {
  key: string;
  productId: string;
  name: string;
  options: string[];
  optionIds: string[];
  quantity: number;
  note: string;
  unit: number;
  total: number;
};
export function priceLines(input: unknown, products: Product[]): OrderLine[] {
  const lines = z.array(lineInput).max(50).parse(input);
  const result = new Map<string, OrderLine>();
  for (const l of lines) {
    const p = products.find((p) => p.id === l.productId);
    if (!p?.available) throw new Error('Product niet beschikbaar');
    const ids = [...new Set(l.optionIds)].sort();
    const opts = ids.map((id) => {
      const o = p.options.find((o) => o.id === id);
      if (!o) throw new Error('Onbekende optie');
      return o;
    });
    for (const o of p.options) {
      const count = opts.filter((x) => x.group === o.group).length;
      if (count > o.max) throw new Error('Te veel opties in groep');
      if (count < (o.min || 0))
        throw new Error('Kies de verplichte variant: ' + (o.groupLabel || 'productoptie'));
    }
    const unit = p.cents + opts.reduce((n, o) => n + o.cents, 0);
    const note = l.note.trim();
    const key = hash(JSON.stringify([p.id, ids, note]));
    const quantity = (result.get(key)?.quantity || 0) + l.quantity;
    if (quantity > 30) throw new Error('Maximaal 30 per productcombinatie');
    result.set(key, {
      key,
      productId: p.id,
      name: p.name,
      options: opts.map((o) => o.name),
      optionIds: ids,
      quantity,
      note,
      unit,
      total: unit * quantity,
    });
  }
  return [...result.values()].sort((a, b) => a.key.localeCompare(b.key));
}
export function syncHistory() {
  return all('SELECT id,at,success,digest,error FROM syncs ORDER BY at DESC LIMIT 30');
}
