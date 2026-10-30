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

- 52 unit-/integratietests geslaagd; de live bronproef wordt in de standaardrun bewust overgeslagen.
- 21 Playwright-tests geslaagd: desktop Chromium, Android-weergave en iPhone/WebKit.
- Expliciete live bronproef geslaagd: `SMIKKEL_LIVE_SOURCE=1 npx vitest run tests/live-source.test.ts`. Actuele bron: 213 producten, 211 beschikbaar; alle beschikbare optievensters verwerkt. Geen bestellingen geplaatst op de cafetariawebsite.
- TypeScript/Svelte: nul fouten/waarschuwingen. ESLint geslaagd.
- Distroless Docker-build en container-smoketest geslaagd, inclusief MFA/CSRF/HTTPS, niet-root en read-only.
- CodeQL en de high/critical-containerscan zijn geslaagd. Open low-severity builddependency-meldingen blijven beschreven in SECURITY.md.

De laatste commit wordt opnieuw in GitHub Actions gecontroleerd vóór image-publicatie. Definitieve run- en imageverwijzingen staan in de PR; een lokale eerdere test is geen bewijs voor een latere gewijzigde commit.

Aanvullende regressies controleren atomische sleutelinitialisatie, behoud van bestaande sleutels, weigeren van symlinks/corrupte bestanden en de publicatiepoort bij een hoge CodeQL-SARIF-bevinding of ontbrekend scanresultaat.

## Achtergrond­synchronisatie-regressies

De aanvullende suites controleren HTTP-202-start en statusautorisatie, gelijktijdige starts/SQLite-exclusiviteit, cooldown, ingestelde vertraging, publicatie na volledigheid, behoud van eerdere catalogi/ronde-snapshots, bronfouten/timeoutredactie, ingetrokken bronrechten, queue/lease/herstart/herstel, verlopen ronde-opdrachten en ingetrokken beheerrechten. Een taak met 213 producten wordt met virtuele tijd voorbij Cloudflares normale requestvenster gevolgd; de HTTP-start is dan al afgerond en status blijft beschikbaar.

Client- en Playwright-tests simuleren Cloudflare 502/504/524-HTML, ongeldige JSON, een onzekere startrespons, voortgang na herladen en herstel van polling zonder dubbele POST. Playwright gebruikt een eigen database en wist alleen zijn geïsoleerde testgegevens tussen runs.

De expliciete live bronproef doorloopt nu dezelfde persistente worker en atomische publicatie op een tijdelijke database. Hij gebruikt uitsluitend read-only verzoeken met minimaal de productievertraging; hij configureert geen SMTP/IMAP en plaatst geen cafetariabestelling. Uitvoeren: `SMIKKEL_LIVE_SOURCE=1 npx vitest run tests/live-source.test.ts`. Zie de PR voor actuele aantallen en CI-resultaten; oudere resultaten hierboven horen bij de oorspronkelijke implementatie.

Uitgevoerd voor de synchronisatieherziening op 29 oktober 2026: 76 unit-/integratietests geslaagd (de afzonderlijke live proef is standaard overgeslagen), 33 Playwright-tests geslaagd over de drie browserprojecten en een expliciete live workerproef geslaagd voor 213 producten/211 beschikbare optievensters in 274.763 ms. Typecontrole, lint, productie-/Docker-build en de echte container-herstartproef zijn eveneens geslaagd. De regressies omvatten bronwerk voorbij 125 seconden zonder open startrequest; proxy-time-outs worden gesimuleerd zonder Cloudflare of de cafetaria extra te belasten. GitHub Actions controleert de gepushte commit opnieuw vóór publicatie.

## Ronde-aanmaakregressies

De aanvullende tests bewijzen directe creatie zonder bronverkeer met een verse snapshot (inclusief opties/beschikbaarheid), de exacte 30-minutengrens, weigeren van mislukte/toekomstige/beschadigde brongegevens, bronrechten en planningvalidatie. Persistente aanvraagdeduplicatie wordt gecontroleerd met meerdere identieke aanvragen, conflicterende invoer, eigenaarautorisatie, 213 producten met meer dan 125 seconden virtuele bronduur en een echte containerherstart. Verplichte nieuwe broncontrole en blokkeren van gewijzigde prijzen vóór verzending blijven getest. De live cafetariaproef is hiervoor niet opnieuw nodig: de bronadapter is niet gewijzigd.

Playwright controleert ook in iPhone/WebKit ISO-datums bij afwijkende en-CA-weergave, een verloren HTML-524-antwoord na een werkelijk aangemaakte ronde, herhaalde klikken, reload tijdens bronwerk en Nederlandse datum-/tijdmeldingen. Resultaten worden pas na uitvoering in de PR vastgelegd.

## Geplande medewerkersrondes

Unit-/integratietests controleren metadata vóór opening zonder snapshot, expliciete API-projectie/eigenaarfilter, openings-/sluitingsmilliseconde, schedulervertraging, geannuleerde/geblokkeerde/verwerkte rondes, volgende rondes in tijdvolgorde, eigen bestelling na sluiting en ongewijzigde deelnamevoorkeuren. Amsterdam-middernacht, de ontbrekende lentetijden en beide herfst-offsets worden met absolute tijdstippen getest.

Playwright controleert geplande/open/gesloten kaarten, automatisch openen, behoud van een onopgeslagen mandje tijdens polling, sluiten tijdens een traag statusrequest, serverweigering van een oude POST, annulering, privacy en pauze/vakantie/overslaan in desktop Chromium, Android Chromium en iPhone/WebKit. De bronadapter is niet gewijzigd; hiervoor wordt de cafetaria niet opnieuw live bevraagd. Definitieve aantallen en CI-/imageverwijzingen staan in de PR. Handmatige Synology-acceptatiestappen staan in EMPLOYEE_ROUNDS.md.
