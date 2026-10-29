export async function api(path: string, data?: unknown) {
  const r = await fetch(
    '/api/' + path,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const value = await r.json();
  if (!r.ok) throw new Error(value.message || 'Deze actie is niet gelukt');
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
