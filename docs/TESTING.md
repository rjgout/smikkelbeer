# Testaanpak

`npm run check`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm audit --audit-level=moderate` en `BUILDING=1 npm run build` zijn de controles. GitHub Actions voert ze uit, scant code met CodeQL en het runtime-image met Trivy vóór publicatie.

Unit-/integratietests gebruiken tijdelijke SQLite-databases en vaste HTML-fixtures: migraties (ook met bestaande data), encryptie, MFA/replay, tokens/expiry/verificatie, rollen/accountscheiding, namen/afwezigheid, broncontracten/opties/prijzen, orders/revisies/deadlines, snapshots/bronwijzigingen, keuken-/persoonstotalen, DST, correcties, outbox/deduplicatie/SMTP-fout/onzekerheid/crash, mailreview, SSRF-grenzen, back-up/herstel en scheduler.

Playwright gebruikt desktop Chromium, Pixel 7 Chromium en iPhone 13 WebKit. Echte UI/API-verzoeken testen bestellen/wijzigen, favorieten, zoeken, profiel/afwezigheid, scanner-GET/CSRF, gelijktijdige tokenconsumptie en orderupdates, MFA/RBAC en responsive weergave. De server gebruikt uitsluitend fictieve `.e2e-data/`, geen geconfigureerde SMTP-provider. Uitgaande unit-tests gebruiken een geïnjecteerde testadapter en versturen niets.

Fixtures zijn gereduceerde publieke bronvoorbeelden van 29 oktober 2026, uitsluitend voor tests. Ze worden nooit als productiemenukaart ingeladen. Browseremulatie is geen fysieke iPhone-/Android-acceptatietest.

## Nog handmatig te accepteren

- Volledige live menukaart/varianten en voorwaarden/toestemming.
- Safe Links, echte SMTP/IMAP-provider, Outlook/mobile en A4-print.
- Volledige testronde, ontvangstcontrole, time-outs, bronwijzigingen en procesonderbreking.
- Installatie/update/rollback/herstel op eigen NAS.
- Fysieke browsers, toetsenbord/focus, screenreader en zoom.
- Onafhankelijke beveiligingsreview en privacy-/organisatietoestemming.

Zie de PR voor daadwerkelijk uitgevoerde resultaten. Tests gelden uitsluitend als geslaagd nadat ze zijn uitgevoerd.

`npm run test:container` controleert het echte image: niet-root/read-only-start, migraties, healthcheck, weigeren van ontbrekende HTTPS-proxyheaders en CSRF, lokale bootstrap, TOTP, Secure/HttpOnly/SameSite-cookies, accountscheiding en bestandsrechten. Het gebruikt een afzonderlijk tijdelijk volume en geen externe mailprovider.

## Uitgevoerd tijdens implementatie (29 oktober 2026)

- 49 unit-/integratietests geslaagd; de live bronproef wordt in de standaardrun bewust overgeslagen.
- 21 Playwright-tests geslaagd: desktop Chromium, Android-weergave en iPhone/WebKit.
- Expliciete live bronproef geslaagd: `SMIKKEL_LIVE_SOURCE=1 npx vitest run tests/live-source.test.ts`. Actuele bron: 213 producten, 211 beschikbaar; alle beschikbare optievensters verwerkt. Geen bestellingen geplaatst op de cafetariawebsite.
- TypeScript/Svelte: nul fouten/waarschuwingen. ESLint geslaagd.
- Distroless Docker-build en container-smoketest geslaagd, inclusief MFA/CSRF/HTTPS, niet-root en read-only.
- CodeQL en de high/critical-containerscan zijn geslaagd. Open low-severity builddependency-meldingen blijven beschreven in SECURITY.md.

De laatste commit wordt opnieuw in GitHub Actions gecontroleerd vóór image-publicatie. Definitieve run- en imageverwijzingen staan in de PR; een lokale eerdere test is geen bewijs voor een latere gewijzigde commit.
