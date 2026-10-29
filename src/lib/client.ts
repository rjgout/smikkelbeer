export class ApiError extends Error {
  constructor(
    message: string,
    public httpStatus: number,
    public code: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api(path: string, data?: unknown, options: { signal?: AbortSignal } = {}) {
  let r: Response;
  try {
    r = await fetch('/api/' + path, {
      ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
      headers: {
        Accept: 'application/json',
        ...(data === undefined ? {} : { 'content-type': 'application/json' }),
      },
      signal: options.signal,
    });
  } catch {
    throw new ApiError(
      'De verbinding is onderbroken of het verzoek duurde te lang. Een gestarte achtergrondtaak kan nog doorlopen; haal de status opnieuw op.',
      0,
      'NETWORK',
    );
  }
  const rawRay = r.headers.get('cf-ray');
  const ray = rawRay && /^[a-zA-Z0-9-]{1,80}$/.test(rawRay) ? rawRay : undefined;
  const timeout = [408, 504, 524].includes(r.status);
  const proxyMessage = timeout
    ? 'De verbinding via de proxy is verlopen (HTTP ' +
      r.status +
      '). Een gestarte synchronisatie kan nog op de achtergrond doorlopen. Haal de status opnieuw op.'
    : 'De server of proxy gaf geen bruikbaar antwoord (HTTP ' +
      r.status +
      '). Probeer de status opnieuw op te halen.';
  let value: any;
  if (!/^application\/(?:[a-z0-9.-]+\+)?json(?:;|$)/i.test(r.headers.get('content-type') || ''))
    throw new ApiError(proxyMessage, r.status, timeout ? 'PROXY_TIMEOUT' : 'INVALID_RESPONSE', ray);
  try {
    value = await r.json();
  } catch {
    throw new ApiError(proxyMessage, r.status, 'INVALID_JSON', ray);
  }
  if (!r.ok)
    throw new ApiError(
      r.status >= 500
        ? proxyMessage
        : typeof value?.message === 'string'
          ? value.message
          : 'Deze actie is niet gelukt.',
      r.status,
      value?.code || 'REQUEST_FAILED',
      ray,
    );
  return value;
}
export const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);
export const time = (v: number) =>
  new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v));
export const date = (v: number) =>
  new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(v));
export const statusLabel: Record<string, string> = {
  planned: 'Gepland',
  open: 'Bestellen geopend',
  closed: 'Gesloten',
  blocked: 'Controle nodig',
  queued: 'Klaar voor verzending',
  sending: 'Verzending bezig',
  sent: 'Verzonden',
  unknown: 'Verzendstatus onbekend',
  failed: 'Verzending mislukt',
  confirmed: 'Ontvangst bevestigd',
  review: 'Handmatige beoordeling nodig',
  completed: 'Afgehandeld',
  cancelled: 'Geannuleerd',
  pending: 'In wachtrij',
};

// Assemble ISO calendar fields explicitly; locale display order is not an HTML contract.
export function calendarDate(value = new Date(), timeZone = 'Europe/Amsterdam') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}
