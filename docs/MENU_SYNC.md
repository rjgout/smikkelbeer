# Achtergrond­synchronisatie en Cloudflare-diagnose

## Onderzoek van de gemelde fout

De oude `POST /api/menu/sync` wachtte rechtstreeks op `syncMenu()`. Bij de eerder gecontroleerde 211 beschikbare producten waren alleen de pauzes al minimaal 211 seconden; HTTP-verkeer en validatie kwamen daar nog bij. De live healthcheck van `https://smikkelbeer.gout.nl` gaf HTTP 200/JSON met `CF-Ray` en `CF-Cache-Status: DYNAMIC`, wat de Cloudflare-route bevestigt.

De actuele [Cloudflare-documentatie over 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/) noemt een standaard Proxy Read Timeout van 125 seconden en adviseert statuspolling voor lange processen. De oude requestduur overschrijdt die standaard aantoonbaar. De exacte timeoutconfiguratie van deze zone en de HTTP-respons/NAS-log van de gemelde mislukte POST zijn niet beschikbaar: een daadwerkelijke 524 bij dat incident wordt daarom niet als gemeten feit geclaimd. Een andere proxyfout of oorsprongfout blijft mogelijk.

Daarnaast las `api()` iedere respons onvoorwaardelijk met `response.json()`, vóór het controleren van de HTTP-status. Een HTML-foutpagina van Cloudflare kon daardoor achter een browserspecifieke parsefout verdwijnen, zoals de gemelde patroonmelding. Die melding op zichzelf identificeert de HTTP-fout niet. Dit scenario is met HTML-524-antwoorden in unit- en WebKit-tests gereproduceerd.

## Protocol

| Endpoint | Gedrag |
|---|---|
| `POST /api/menu/sync` | Menu-recht vereist; legt een taak vast en antwoordt direct 202 met `job`, `reused`, `Location` en `Retry-After: 2`. Een lopende taak wordt gevolgd zonder nieuw bronwerk. |
| `GET /api/menu/sync/status` | Menu- of ronderecht vereist; geeft actieve/laatste taak, laatste geslaagde broncontrole en vroegste herstarttijd. |
| `GET /api/menu/sync/status?id=UUID` | Zelfde autorisatie; geeft de specifieke persistente taak. Ongeldige ID: 400, onbekende taak: 404. |
| `POST /api/rounds/create` | Valideert eerst planning/overlap, legt broncontrole plus ronde-opdracht vast en antwoordt 202. De ronde ontstaat pas na volledige broncontrole. |
| `POST /api/rounds/recheck` | Legt voor een gevulde gesloten/geblokkeerde ronde een broncontrole vast en antwoordt 202. Een lege ronde wordt zonder bronwerk of cafetariamail afgehandeld. |

Geen browserrequest blijft open tijdens de scraper. Alleen de interne scheduler mag de gedeelde taak afwachten. Een tweede ronde-opdracht tijdens bronwerk krijgt een begrijpelijke 409; er komt geen tweede scraper bij. Na een afgeronde of onderbroken poging volgt minimaal één minuut wachttijd (429 met `Retry-After`).

## Opslag en exclusiviteit

Migratie `004_menu_sync_jobs.sql` voegt uitsluitend een nieuwe tabel met indices toe; bestaande catalogi, bestellingen en ronde-snapshots blijven behouden. Een gedeeltelijke unique-index staat maximaal één `queued` of `running` taak toe, ook bij meerdere databaseverbindingen. Claim en publicatie gebruiken `BEGIN IMMEDIATE`.

Statussen: `queued → running → succeeded`, of `failed`/`interrupted`. De fases zijn `queued`, `menu`, `options`, `applying` en `complete`. Voortgang wordt na ieder gecontroleerd product opgeslagen. Niet-beschikbare producten tellen mee in het totaal, maar krijgen geen extra bronrequest. Productgegevens worden tijdens de controle niet gepubliceerd.

Een draaiende taak heeft een willekeurige eigenaar en een werklease van 90 seconden, elke 10 seconden vernieuwd. De worker controleert die eigenaar/lease vóór nieuwe bronrequests en onder de database-transactie vóór publicatie. Een oude worker kan na verlies van de lease geen catalogus of ronde-effect meer toepassen. Dit ondersteunt veilige onderbrekingsdetectie; de applicatie blijft ontworpen voor één replica.

Minimaal de ingestelde vertraging (standaard 1000 ms) blijft vóór ieder optievenster gelden. Een tijdens de taak verhoogde vertraging wordt gerespecteerd; verlagen verkort de bestaande taak niet. Bron-URL, HTTP-timeout van 20 seconden per request, responsgroottegrens, structuurvalidatie en brongoedkeuring blijven gehandhaafd.

## Volledigheid en fouten

Pas wanneer alle producten en beschikbare optievensters correct zijn gecontroleerd en de voortgang exact op het totaal staat, worden de complete JSON-catalogus en digest atomisch aan `syncs` toegevoegd. Bestaande records worden niet overschreven. Een bronfout krijgt een mislukt historisch record zonder gedeeltelijke producten. Nieuwe rondes kunnen niet stilzwijgend terugvallen op een oude catalogus na een bronfout; bestaande rondes blijven hun eigen onveranderlijke snapshot gebruiken.

Daarna kan een gekoppelde ronde-opdracht worden toegepast. Rechten, testmodus, deadlines, overlap en voorbereidingstijd worden opnieuw gecontroleerd. Bij zo'n vervolgprobleem blijft de volledig gecontroleerde catalogus geldig en krijgt de taak een aparte ronde-diagnose. Een succesvolle broncontrole betekent niet automatisch dat een bestelling is verzonden: controleer steeds de rondestatus.

De status-API retourneert alleen gewhiteliste metadata: teller, totaal, fase/tijden, product-ID, veilige foutcode/tekst en resultaat-ID. Geen actor, payload, lease-eigenaar, credentials, externe HTML of ruwe exceptiontekst. Relevante codes zijn `SOURCE_HTTP`, `SOURCE_TIMEOUT`, `SOURCE_STRUCTURE`, `SOURCE_UNAVAILABLE`, `PROCESS_INTERRUPTED`, `SCRAPING_DISABLED`, `PERMISSION_REVOKED`, `MODE_CHANGED` en `ROUND_ACTION_FAILED`.

## Browser en verbinding

De beheerpagina vraagt elke twee seconden status op terwijl een taak loopt. Er is maximaal één statusrequest tegelijk, met tien seconden timeout en oplopende herhaalpauze tot vijftien seconden bij verbindingsfouten. Herladen haalt dezelfde taak uit SQLite op. Het sluiten van het scherm stopt geen bronwerk. De browser herhaalt een start-POST nooit automatisch; bij een onzekere startrespons vraagt hij eerst de status op.

`api()` controleert inhoudstype en JSON-verwerking en behoudt de HTTP-status. Proxy-HTML en ongeldige JSON leveren Nederlandse meldingen op, inclusief een veilige `CF-Ray`-referentie indien aanwezig. Een 524 tijdens polling zegt niets over het resultaat van de servertaak; status opnieuw ophalen is de aangewezen actie.

## Herstart, afsluiten en herstel

- Normale herstart: nog niet gestarte `queued` taken mogen starten; er is nog geen bronwerk uitgevoerd.
- Graceful shutdown: de worker breekt zijn bronrequest af en schrijft `interrupted` met de laatst opgeslagen voortgang.
- Harde onderbreking: na het verlopen van de werklease (maximaal circa 90 seconden plus de workerpoll) wordt `running` gemarkeerd als `interrupted`. Geen automatische herhaling van mogelijk deels uitgevoerd bronwerk. De beheerder kan na de wachttijd opnieuw starten.
- Back-upherstel: zowel `queued` als `running` taken worden onderbroken en leases worden verwijderd. De back-up kan ouder zijn dan werkelijke latere acties; herstel mag daarom geen oude opdrachten automatisch opnieuw uitvoeren. Ook back-ups van vóór deze tabel blijven herstelbaar.

## Uitrol en diagnose op de NAS

Werk het bestaande preview-image bij via Portainer en recreate de applicatiecontainer met behoud van het datavolume. Geen wijziging van Cloudflare-timeouts, scrapervertraging, HTTPS/CSRF-controles, SMTP-instellingen of functionele Compose-configuratie is nodig. Migratie 004 draait automatisch. Ververs daarna de beheerpagina zodat de nieuwe clientcode geladen is.

Klik éénmaal op synchroniseren. De startrespons hoort vrijwel direct 202 te zijn; daarna volgen korte GET-statusrequests. Noteer bij problemen taak-ID, teller/totaal, foutcode, HTTP-status en eventuele Cloudflare-referentie. Gebruik daarvoor geen inlogtokens, mailwachtwoorden of volledige requestbody's. Laat een bestaande taak doorlopen bij een verbindingsfout en controleer de status vóór een nieuwe start.
