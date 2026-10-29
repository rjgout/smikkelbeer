# Architectuur

Eén Node 24-proces bedient SvelteKit 3 met TypeScript. Svelte 5 bouwt de mobiele medewerkerswebsite en desktopgerichte responsive beheerderswebsite. Een JSON-API voert validatie met Zod, authenticatie en server-side RBAC uit. Externe data wordt als tekst behandeld, nooit als uitvoerbare HTML of instructies. Geen externe analytics, fonts of JavaScript.

## Opslag

SQLite via de ingebouwde `node:sqlite`-driver. Versiebeheerde SQL-migraties in `migrations/`, bijgehouden in dezelfde database, worden voor het bedienen van verzoeken transactioneel uitgevoerd. WAL, foreign keys, FULL synchronous en busy timeout. Geld is altijd een integer aantal centen. `BEGIN IMMEDIATE` beschermt tokenconsumptie, orderversies, outbox en de eerste installatie. Geneste transacties gebruiken savepoints.

Datavolume: `/data/smikkelbeer.sqlite`, WAL/SHM en `/data/master.key`. AES-256-GCM beschermt functionele configuratie, TOTP-secrets, nog niet afgeleverde e-mailinhoud en lopende MFA-installatiegegevens. Bestellingen en medewerkersgegevens zijn niet applicatielaagversleuteld; beveilig en versleutel de NAS-opslag. Rechten 0700 op map en 0600 op hoofdbestanden. Een ontbrekende sleutel bij bestaande versleutelde gegevens blokkeert opstart.

## Accounts

Twee afzonderlijke sessiecookies en identiteitstypen. Geen enkele beheerdersrol verleent een medewerkerssessie. Adminlogin vereist wachtwoord (scrypt N=32768,r=8,p=1) en TOTP; laatst gebruikte tijdstap voorkomt replay. Alle sessies en magic links worden alleen als hash opgeslagen. Medewerkerslinks staan in URL-fragmenten, worden na openen uit de adresbalk verwijderd en vereisen een expliciete POST. GET verbruikt niets. Nieuwe e-mailadressen vereisen verificatie vanuit de eigen sessie.

## Bron → ronde → bestelling → outbox

1. De vaste officiële HTTPS-bron wordt gesynchroniseerd; ieder beschikbaar product krijgt ook een gecontroleerd optiescherm. Vreemde/ontbrekende structuren, redirects, grote antwoorden of niet-ondersteunde varianten blokkeren synchronisatie.
2. Ronde-aanmaak hergebruikt de laatste integere succesvolle broncontrole zolang deze maximaal 30 minuten oud is; anders volgt een aparte achtergrondcontrole. Een persistent aanvraag-ID dedupliceert directe en asynchrone creatie, ook na herstart. Een ronde bewaart een via een database-trigger onveranderlijke product- en prijsmomentopname plus SHA-256-digest.
3. Het bestellen herberekent bedragen vanuit deze momentopname. Optimistische revisies voorkomen verloren updates. Deadlines gelden server-side.
4. De scheduler sluit de ronde en voert vóór verzending een nieuwe bronsynchronisatie uit. Iedere wijziging blokkeert verzending. Een lege ronde wordt zonder mail afgehandeld.
5. Eén gevalideerde orderverzameling genereert keuken- en individuele overzichten. Outboxregels hebben unieke deduplicatiesleutels en Message-ID's.
6. De worker claimt iedere mail persistent. Time-outs of crashes tijdens verzending leveren `unknown` op; geen blinde retry.
7. IMAP wordt iedere twee minuten gelezen. Afzender, bestelnummer, thread en inhoud ondersteunen de beoordeling. Een onbewezen afzender is geen authenticatie: deze versie vereist altijd handmatige ontvangstbevestiging.

## Scheduler en foutgrenzen

Elke 30 seconden binnen hetzelfde proces: rondes starten/sluiten, uitnodigingen en twee optionele herinneringen, verzenden en waarschuwingen. Netwerkoperaties draaien buiten database-transacties. Geen meerdere replica's of meerdere workers op één datavolume. Gemiste deadlines worden bij hervatten verwerkt; uitgevallen uitnodigingsmomenten worden niet naar het verleden verschoven.

Bronaanvragen: vaste host/paden, geen configureerbare URL, minimaal één seconde tussen productvensters, één synchronisatie tegelijk en minimaal één minuut tussen pogingen. SMTP/IMAP gebruiken publiek IPv4, DNS-pinning per verbinding, TLS-hostnaamvalidatie en TLS 1.2+. Interne mailrelays/IPv6-only-providers hebben een apart beoordeelde adapter nodig.

## Persistente menukaartworker

Menukaartsynchronisaties en afhankelijke handmatige ronde-acties verlaten de HTTP-requestketen via een SQLite-taak met HTTP 202 en een apart statusendpoint. De worker draait in hetzelfde applicatieproces, met database-exclusiviteit, heartbeat/werklease, fencing en atomische publicatie van uitsluitend volledige catalogi. De browser pollt de taak en kan herladen of sluiten. Zie MENU_SYNC.md voor protocol, toestandsovergangen, foutgrenzen en herstel. Dit voegt geen container, externe queue of functionele omgevingsvariabelen toe.
