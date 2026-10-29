import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
// Mailservers are pinned to a resolved public IPv4 address for this connection.
// Internal/LAN mail relays require a separately reviewed adapter.
export function publicIPv4(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}
export async function mailAddress(host: string) {
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host)) throw new Error('Ongeldige mailserver');
  const addresses = await lookup(host, { all: true, family: 4 });
  if (!addresses.length || addresses.some((a) => !publicIPv4(a.address)))
    throw new Error('Mailserver moet een publiek IPv4-adres hebben');
  return addresses[0].address;
}
