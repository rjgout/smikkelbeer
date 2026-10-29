import { load } from 'cheerio';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { all, one, run, audit } from './db';
import { hash } from './crypto';
import { settings } from './config';
export type Option = { id: string; name: string; cents: number; group: string; max: number };
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
  if ($('#addProductForm select').length)
    throw new Error('Niet-ondersteunde verplichte variant; bronadapter bijwerken');
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
async function fetchSource(path: string) {
  if (path !== '/' && !/^\/order\/product\/add\/\d+$/.test(path))
    throw new Error('Bronpad niet toegestaan');
  const response = await fetch(source + path, {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent': 'Smikkelbeer/0.1 (low-frequency menu synchronization)',
      Accept: 'text/html',
    },
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html'))
    throw new Error('Bron niet beschikbaar');
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
let syncing = false;
export function digest(products: Product[]) {
  return hash(JSON.stringify(products));
}
export async function syncMenu(actor = 'system') {
  if (syncing) throw new Error('Synchronisatie loopt al');
  const s = settings();
  if (!s.scrapingApproved)
    throw new Error('Beoordeel bronvoorwaarden en activeer synchronisatie in Instellingen');
  const recent = one('SELECT at FROM syncs ORDER BY at DESC LIMIT 1');
  if (recent && Date.now() - recent.at < 60000)
    throw new Error('Wacht minimaal één minuut tussen synchronisaties');
  syncing = true;
  const id = randomUUID();
  try {
    const products = parseMenu(await fetchSource('/'));
    for (const p of products) {
      if (!p.available) continue;
      await new Promise((r) => setTimeout(r, s.syncIntervalMs));
      p.options = parseOptions(await fetchSource('/order/product/add/' + p.id), p.id);
    }
    run(
      'INSERT INTO syncs VALUES (?,?,1,?,?,NULL)',
      id,
      Date.now(),
      digest(products),
      JSON.stringify(products),
    );
    audit(actor, 'menu.sync', id, { count: products.length });
    return { products, digest: digest(products) };
  } catch (e) {
    run(
      'INSERT INTO syncs VALUES (?,?,0,NULL,NULL,?)',
      id,
      Date.now(),
      e instanceof Error ? e.message : 'Bronfout',
    );
    throw e;
  } finally {
    syncing = false;
  }
}
export function latestMenu() {
  const row = one('SELECT * FROM syncs ORDER BY at DESC LIMIT 1');
  if (!row || !row.success || Date.now() - row.at > 30 * 60000)
    throw new Error('Menukaart ontbreekt, is verouderd of synchronisatie mislukt');
  return { products: JSON.parse(row.products) as Product[], digest: row.digest, at: row.at };
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
    for (const o of opts)
      if (opts.filter((x) => x.group === o.group).length > o.max)
        throw new Error('Te veel opties in groep');
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
