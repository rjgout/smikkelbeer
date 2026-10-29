# Beveiliging en privacy

Deze implementatie is geen ASVS-, BIO2- of AVG-certificering. Toestemming en privacy-/beveiligingstoetsing door Gemeente Westerkwartier zijn vóór verwerking van echte medewerkersgegevens op een privé-NAS noodzakelijk. Gebruik tot die tijd fictieve gegevens.

## Ingebouwde maatregelen

- Geen openbare registratie. Alleen bevoegde beheerders voegen medewerkers toe.
- Gescheiden admin-/medewerkerstabellen, identiteitstypen, gehashte sessies en cookies. Admin: één uur, medewerker: acht uur. HttpOnly, Secure in de build, SameSite Strict.
- Scrypt-wachtwoorden, verplichte TOTP, beperkte verificatievensters en tijdstapcontrole tegen replay. Geen bypass bij login. Eerste installatie vereist een lokaal gegenereerde code van 256 bits, gehasht opgeslagen, 15 minuten geldig.
- Magic links: 256 bits, SHA-256-opslag, beperkte levensduur, expliciete POST en atomische single-use. Fragmenttoken gaat niet naar server- of proxytoegangslogs. Geen analytics; no-referrer. GET, inclusief mailscanners, consumeert niets.
- JSON-acties vereisen een overeenkomende Origin en JSON Content-Type. Requestbody maximaal 64 KiB, ook bij chunked encoding. SQL gebruikt parameters. Svelte escaped weergave; e-mails ontsnappen namen, opties en opmerkingen.
- Iedere serveractie controleert de vereiste rol. Alleen volledige beheerders beheren roltoewijzingen. Systemrollen kunnen niet worden aangepast; laatste volledige beheerder wordt via databasetriggers beschermd. Custom rollen kunnen geen `*` verkrijgen.
- Persistente limieten per IP/gehasht adres en aanvullend per account. De socket-IP is conservatief de proxy-IP; geen vertrouwen op willekeurige forwardingheaders voor limitering.
- CSP, HSTS, no-sniff, frame denial, no-store en beperkte browserpermissions. CSP staat inline CSS toe voor Svelte-styling; geen scripts van derden.
- AES-256-GCM voor credentials, TOTP, bootstrap-MFA en niet-afgeleverde berichtinhoud. Sleutel buiten de database in dezelfde beveiligde volumemap. Back-ups bevatten gevoelige data en moeten extern versleuteld worden bewaard.
- Scraperhost en paden zijn vast; redirects, onverwachte structuren en te grote bodies worden geweigerd. Mailserver-DNS wordt vóór de verbinding gecontroleerd en het publieke IPv4-adres wordt vastgezet met TLS-servernaamvalidatie. Geen localhost-/LAN-/metadata-SSRF via SMTP/IMAP.
- Geen automatische retry na onbekende SMTP-uitkomst. Bij herstart/restore worden mogelijk verzonden mails expliciet onzeker. Message-ID en deduplicatiesleutels zijn persistent.
- Inkomende e-mail wordt begrensd en uitsluitend als tekst getoond. Geen HTML-rendering, attachments, scripts of instructieverwerking; iedere ontvangstbevestiging vereist menselijke beoordeling.
- Niet-root container, alle capabilities weg, no-new-privileges, read-only root, beperkte tmpfs, loopbackpoort en resources. Eén replica.

## Open beveiligingswerk vóór productie

1. Onafhankelijke review van autorisatie, CSRF, sessies, tokens, scrypt/TOTP, scraper en mailafhandeling; volledige ASVS-mapping en penetratietest.
2. Test SMTP/IMAP met de echte provider en haar toegestane authenticatie. OAuth2 ontbreekt. Geen claim van geauthenticeerde automatische ontvangstherkenning; daarvoor is providergebonden bewijs nodig.
3. Controleer proxyheaders, TLS, directe containerbereikbaarheid, NAS-/Portainerrechten en encryptie van opslag en externe back-ups. De proxy moet forwardingheaders zelf overschrijven.
4. Herstelbeleid voor verlies van alle MFA-middelen is nog niet via een beheerwizard beschikbaar. Bewaar TOTP-secrets in een beveiligde kluis en stel ten minste twee volledige beheerders in. Geen geheime noodlogin.
5. Beoordeel bewaartermijnen. Afgehandelde/geannuleerde bestellingen worden opgeruimd; onzekere open transacties blijven bewust bewaard voor afhandeling. Medewerkeraccounts worden gedeactiveerd; een volledige AVG-export/verwijderworkflow ontbreekt nog.
6. Betalingsrol ziet alleen namen/bedragen/statussen; geen e-mailadressen of bestelregels. Auditlog is databasegebaseerd, niet extern onveranderlijk. Een NAS-root kan gegevens en logs wijzigen.
7. Toegangslogs van reverse proxy en mailprovider zijn onderdeel van het beheerdomein; zet geen requestbodylogging aan. De server geeft onverwachte fouten generiek terug en logt geen tokens of mailcredentials.
8. Een bevoegde systeembeheerder kan uitgaande SMTP/IMAP-hosts configureren; de publieke IPv4-allowstrategie staat externe hosts toe. Stel zo nodig netwerk-egressbeleid in voor uitsluitend de daadwerkelijke provider.
9. Publieke URL-configuratie moet de werkelijke HTTPS-origin zijn. Tijdens ongeconfigureerde bootstrap is uitsluitend de lokaal gegenereerde code de toegangspoort tot installatie.

Meld beveiligingsproblemen privé aan de repository-eigenaar, nooit met secrets of persoonsgegevens in een publiek issue.

## Open dependencybevinding

Na upgrade naar gepatchte hoofdversies blijft een low-severity `deepmerge`-melding (GHSA-gcqx-w48m-w2h4) in de Svelte Vite-buildketen over, met vier doorgegeven pakketmeldingen. Upstream heeft nog geen gepatchte versie. Hier wordt alleen vertrouwde buildconfiguratie gemerged, geen requestdata. Geen onveilige downgrade of onderdrukking toegepast: CI toont alle meldingen en blokkeert moderate/high/critical. Beoordeel dit restrisico vóór productie.

De productiehook vereist expliciet `X-Forwarded-Proto: https`; de HTTPS-default van adapter-node zonder header wordt niet vertrouwd. Alleen de bestaande vertrouwde reverse proxy mag de container bereiken en deze header zetten. De container-smoketest controleert dat ontbrekende forwardingheaders worden geweigerd.

De CodeQL-bevinding over een bestandssysteemrace bij sleutelinitialisatie is opgelost met descriptor-gebaseerde toegang: atomisch exclusief aanmaken, O_NOFOLLOW, fsync en lezen/rechten instellen op dezelfde descriptor. Ontbrekende bestaande sleutels, symlinks en corrupte bestanden worden geweigerd. De CI-publicatie wacht tevens op een aparte SARIF-poort die moderate/high/critical CodeQL-resultaten blokkeert; alleen een groene analyse-upload is onvoldoende bewijs. Herstel kopieert met COPYFILE_EXCL om bestaande doelbestanden nooit te overschrijven.

Menukaarttaken worden uitsluitend via bestaande server-side rechten gestart. De status-API vereist menu- of ronderechten en geeft geen payload, actor of werklease-eigenaar prijs. Brongoedkeuring, vaste host/paden, bronvalidatie, minimale vertraging en cooldown blijven gehandhaafd. Exclusieve SQLite-index, werklease en fencing voorkomen overlappende publicatie. Onbekende transportfouten en proxy-HTML worden niet teruggegeven. Herstel onderbreekt ook queued bronopdrachten; een onzekere browserverbinding herhaalt nooit automatisch een start-POST. Zie MENU_SYNC.md.

Verse momentopnamen worden bij ronde-aanmaak alleen hergebruikt na controle van leeftijd, laatste bronuitkomst en SHA-256-integriteit. Bronrechten, product-/optie-/prijsvalidatie en volledige broncontrole vóór verzending blijven gelden. Rondeaanvraag-IDs zijn per beheerder afgeschermd; invoer/testmodus worden gehasht en conflicterend hergebruik wordt geweigerd. GET-status creëert nooit een ronde. Aanvraag en ronde/taak worden atomisch vastgelegd; bestaande snapshots blijven onveranderlijk.
