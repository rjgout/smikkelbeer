# Codex Masterprompt — Smikkelbeer

## Opdracht

Bouw een complete, moderne, veilige en productiegerichte snackbestelwebsite met de naam **Smikkelbeer**.

GitHub-repository: https://github.com/rjgout/smikkelbeer

De repository is bij aanvang leeg. Zet het volledige project op, inclusief frontend, backend, database, Docker, tests, documentatie en GitHub Actions.

**Ik wil dat je daadwerkelijk programmeert, niet alleen een ontwerp maakt.** Werk zelfstandig, neem verantwoorde technische beslissingen en voer tests uit. Stel uitsluitend vragen als een cruciale beslissing onmogelijk verantwoord zelfstandig te nemen is.

### Ontwerpprioriteiten

1. **Beveiliging boven alles.**
2. **Uitgebreid automatisch en handmatig testen.**
3. **Maximaal gebruikersgemak.**
4. **Een moderne, consistente en aantrekkelijke interface.**
5. **Eenvoudig beheer en onderhoud.**
6. **Zo min mogelijk externe afhankelijkheden en kosten.**

De applicatie wordt gebruikt door medewerkers van Team Informatie en Automatisering van Gemeente Westerkwartier. Zij bestellen gezamenlijk snacks bij Cafetaria 't Centrum in Marum.

De website automatiseert de uitnodigingen, bestellingen, menukaart, verzamellijst, verzending, ontvangstbevestigingen en eventueel het bijhouden van terugbetalingen.

## 1. Technische architectuur

Gebruik bij voorkeur:

- SvelteKit met TypeScript voor frontend en backend.
- SQLite met een betrouwbare migratielaag, bijvoorbeeld Drizzle ORM.
- Een lichtgewicht, professioneel componentensysteem.
- Server-side validatie, bijvoorbeeld met Zod.
- Docker Compose voor deployment.
- GitHub Actions voor tests, securityscans en Docker-imagebouw.
- GitHub Container Registry (GHCR) voor de images.
- Playwright voor end-to-endtests.

Je mag alternatieven gebruiken als deze aantoonbaar beter passen. Documenteer belangrijke keuzes.

### Hosting

De applicatie draait op een Synology DS1520+ in Docker via Portainer.

De gebruiker wil via GitHub een Compose-stack kunnen ophalen. Maak daarom een volledige `compose.yaml` die een vooraf gebouwd GHCR-image kan starten.

De website wordt via een bestaande reverse proxy of Cloudflare Tunnel via HTTPS bereikbaar gemaakt.

Vereisten:

- Eén applicatiecontainer heeft de voorkeur.
- Persistent volume voor database, sleutels en relevante data.
- Veilige, niet-root-container.
- Geen onnodige open poorten of containerrechten.
- Healthcheck, restartbeleid en nette shutdown.
- Betrouwbare databaseback-ups en migraties.
- Ondersteuning voor updates zonder gegevensverlies.
- Geen afhankelijkheid van Synology-specifieke API's.

**Alle functionele configuratie moet via de beveiligde beheerderswebsite plaatsvinden.**

Dus ook SMTP, IMAP, de publieke URL, ontvangers, planning, rollen, deadlines, scraperinstellingen, bewaartermijnen en betaalinstellingen.

Docker Compose bevat uitsluitend noodzakelijke infrastructuurinstellingen zoals image, poort, volume en beveiligingsopties. Geen functionele instellingen en geen SMTP-wachtwoorden.

Ontwerp een veilige oplossing waarbij encryptiesleutels automatisch worden geïnitialiseerd, beschermd en herstelbaar blijven. Maak een gedocumenteerd back-up- en herstelproces.

## 2. Geen app of PWA

Smikkelbeer wordt uitsluitend een normale responsive website.

Dus:

- Geen mobiele app.
- Geen Capacitor.
- Geen App Store-integratie.
- Geen installeerbare PWA.
- Geen serviceworker of offline-firstfunctionaliteit nodig.

Op iPhone en Android opent de website direct in Safari, Chrome of een andere browser.

Gebruik de Apple Human Interface Guidelines als inspiratie voor een fraaie, intuïtieve mobiele interface. Dit betekent niet dat App Store-goedkeuring nodig is.

### Verschillende interfaces

**Medewerkerswebsite: mobile-first.**

Bestellen moet bijzonder gemakkelijk zijn op een telefoon.

**Beheerderswebsite: desktop-first.**

Deze wordt vooral op een computer gebruikt, met overzichtelijke tabellen, zijmenu's, filters en instelschermen.

Op mobiel moet een beheerder in ieder geval snel de verzendtijd, aankomsttijd en verzendstatus van een ronde kunnen bekijken en aanpassen.

De volledige beheerdersomgeving moet wel responsive blijven.

## 3. Accounttypen en authenticatie

Er bestaan twee strikt gescheiden accounttypen.

### Beheeraccounts

- Eigen login.
- Verplichte MFA, minimaal TOTP.
- Configureerbare rollen en rechten (RBAC).
- Eigen beveiligde sessies.
- Auditlogging van beheeracties.

Standaardrollen:

- Volledige beheerder.
- Bestelcoördinator.
- Betalingsverantwoordelijke.

Een volledige beheerder kan aanvullende rollen maken en rechten toewijzen.

Rechten moeten fijnmazig configureerbaar zijn, bijvoorbeeld voor uitnodigingen, medewerkersbeheer, bestellingen, planning, betalingen en systeeminstellingen.

Bescherm systeemkritieke rechten en voorkom privilege-escalatie. De laatste volledige beheerder mag niet worden verwijderd of gedegradeerd.

### Medewerkersaccounts

Medewerkers gebruiken geen wachtwoord.

Een medewerker kan uitsluitend door een bevoegde beheerder of iemand met expliciete uitnodigingsrechten worden toegevoegd. Er is geen publieke zelfregistratie.

Een medewerker heeft alleen:

- Een voornaam.
- Een e-mailadres.
- Persoonlijke instellingen.
- Favorieten.
- Bestellingen en bestelgeschiedenis.
- Deelname- en afwezigheidsinstellingen.

Er is **geen achternaamveld**.

Voornaam is één naam zonder spaties. Samengestelde namen zoals `Henk-Jan` of `HenkJan` zijn toegestaan. Ondersteun ook gangbare letters met accenten.

Voornamen moeten uniek zijn binnen de actieve deelnemers, hoofdletterongevoelig, zodat de cafetaria weet voor wie een bestelling bedoeld is. Gebruik intern altijd stabiele gebruikers-ID's.

### Beheerders zijn geen automatische deelnemers

Een beheerder mag uitsluitend snacks bestellen wanneer diegene ook afzonderlijk als medewerker is geregistreerd.

Een beheeraccount geeft nooit automatisch toegang tot medewerkerbestellingen.

## 4. Eenmalige e-maillinks

Medewerkers ontvangen op een configureerbaar tijdstip automatisch een persoonlijke uitnodigingsmail met een eenmalige link naar de bestelwebsite.

Een link is:

- Cryptografisch willekeurig.
- Kort geldig, standaard 15 minuten.
- Slechts eenmaal bruikbaar.
- Na succesvolle authenticatie definitief ongeldig.
- Veilig opgeslagen als hash.
- Intrekbaar.
- Niet zichtbaar in applicatie- of toegangslogs.

**Let op Microsoft Safe Links en andere mailscanners.**

Het openen van de URL via GET mag de token niet verbruiken. Gebruik een expliciete bevestigingsactie met veilige POST-verwerking en bescherming tegen CSRF. Voorkom gelijktijdige dubbele consumptie.

Na gebruik ontstaat een tijdelijke, veilige browsersessie met HttpOnly-, Secure- en passende SameSite-cookies.

Wanneer iemand later terugkomt, kan diegene op de website het geregistreerde e-mailadres invullen en een nieuwe eenmalige link aanvragen.

Gebruik neutrale terugmeldingen om e-mailenumeratie te voorkomen. Implementeer rate limiting en anti-misbruikmaatregelen.

## 5. Medewerkersprofiel en afwezigheid

Een medewerker mag via de eigen beveiligde sessie:

- Voornaam wijzigen, met controle op uniciteit.
- E-mailadres wijzigen, uitsluitend na verificatie van het nieuwe adres.
- Eigen favorieten beheren.
- Eigen bestellingen bekijken.
- Bevestigingsmails in- en uitschakelen.
- Deelname aan bestelrondes instellen.

### Deelnameopties

1. Normaal meedoen.
2. Eén bestelronde overslaan.
3. Tijdelijk afwezig, bijvoorbeeld vanwege vakantie.
4. Uitnodigingen voor onbepaalde tijd pauzeren.

Bij tijdelijke afwezigheid kiest iemand een begin- en einddatum. Na afloop wordt deelname automatisch hervat.

Tijdens afwezigheid worden geen reguliere uitnodigingen verzonden.

Een gepauzeerde medewerker kan via een nieuw aangevraagde link nog steeds het eigen profiel aanpassen.

Maak expliciet onderscheid tussen vrijwillig pauzeren en een account dat door een beheerder is gedeactiveerd.

Een medewerker kan aangeven: **Deze keer geen snacks**. Dan verschijnt de status 'Doet niet mee' in het dashboard.

## 6. Medewerkerswebsite en menukaart

De website krijgt een aantrekkelijk, rustig en gebruiksvriendelijk ontwerp.

### Favorieten

Bovenaan staat **Mijn favorieten**.

Favoriete producten worden daar weergegeven, maar blijven ook op hun normale plek in de menukaart staan.

Iedere productregel heeft een klikbare ster:

- Gevulde gele ster = favoriet.
- Alleen de omlijning van een ster = geen favoriet.

Op de ster klikken voegt het product toe aan of verwijdert het uit favorieten.

Favorieten zijn persoonlijk en worden blijvend opgeslagen.

Waar de bronmenukaart dit ondersteunt, kunnen ook complete productcombinaties met sauzen en extra's als favoriet worden opgeslagen.

### Drie hoofdcategorieën

De menukaart heeft exact drie hoofdcategorieën:

- **Patat**
- **Snacks**
- **Overige**

Alles dat niet onder Patat of Snacks valt, komt onder Overige.

Onder de favorieten komt de categoriekeuze, gevolgd door een zoekbalk.

De zoekbalk zoekt uitsluitend in de op dat moment geselecteerde categorie. Favorieten blijven bovenaan zichtbaar.

### Bestellen

Ondersteun:

- Producten toevoegen.
- Aantallen verhogen en verlagen.
- Producten verwijderen.
- Productopties en extra's selecteren, uitsluitend wanneer de cafetaria deze daadwerkelijk aanbiedt.
- Eventuele productopmerkingen.
- Overzichtelijk winkelmandje.
- Directe prijsberekening.
- Bestelling bevestigen.
- Bestelling aanpassen zolang de ronde open is.
- Duidelijk tonen tot wanneer wijzigingen mogelijk zijn.

Voorkom dubbele winkelmandregels doordat producten zowel bij favorieten als in de reguliere lijst voorkomen.

## 7. Automatisch ophalen van de menukaart

**De website van Cafetaria 't Centrum in Marum is de enige bron van producten, opties en prijzen.**

Officiële website:

https://www.hetcentrummarum.nl/

Medewerkers of beheerders mogen niet handmatig eigen producten of prijzen toevoegen.

Onderzoek eerst hoe de actuele menukaart technisch wordt aangeboden. Controleer of er een bruikbare publieke gegevensinterface bestaat. Anders mag gecontroleerde webscraping worden gebruikt wanneer dat technisch en juridisch verantwoord is.

Omzeil geen toegangsbeperkingen, CAPTCHA's of anti-botmaatregelen. Respecteer gebruiksvoorwaarden en beperk de belasting van de website.

### Scrapingvereisten

- Automatisch vóór iedere nieuwe bestelronde synchroniseren.
- Automatisch opnieuw controleren vlak voor definitieve verzending.
- Productnamen, bron-ID's, categorieën, prijzen en beschikbaarheid ophalen.
- Eventuele varianten, sauzen en extra's correct uitlezen.
- Producten stabiel identificeren, ook bij wijzigingen in volgorde.
- Bronproducten automatisch naar Patat, Snacks of Overige indelen.
- Geen verzonnen producten, opties of prijzen.
- Geen stille fallback op mogelijk verouderde prijzen.
- Synchronisatiehistorie en foutmeldingen bijhouden.
- Handmatig synchroniseren via de backend.
- Duidelijk tonen wanneer de laatste succesvolle synchronisatie plaatsvond.

Sla per bestelronde een onveranderlijke momentopname van de gebruikte productgegevens en prijzen op.

Wanneer bij de tweede controle prijzen, beschikbaarheid of producten wezenlijk zijn gewijzigd, blokkeer dan de verzending en waarschuw een bevoegde beheerder. Ontwerp een expliciet correctieproces dat voorkomt dat medewerkers ongemerkt met gewijzigde bedragen worden geconfronteerd.

Als scraping faalt, mag de applicatie niet stilzwijgend onjuiste prijzen gebruiken.

Maak afzonderlijke tests met vaste HTML-fixtures en een duidelijke detectie voor wijzigingen in de bronwebsite.

## 8. Bestelrondes en planning

Alle planning is configureerbaar via de backend.

Ondersteun:

- Eén of meer vaste besteldagen per week.
- Automatisch aanmaken van bestelrondes.
- Handmatig starten van extra rondes.
- Feestdagen en uitzonderingen.
- Bestelrondes annuleren.
- Herinneringen versturen.
- Eventueel een tweede herinnering aan niet-reagerende deelnemers.
- Sluitingstijd.
- Verzendtijd naar de cafetaria.
- Gewenste aankomst- of afhaaltijd.
- Minimale voorbereidingstijd.

De bestaande werkwijze verstuurde uitnodigingen om 11:45. Gebruik dit als instelbare voorbeeldwaarde, niet als vaste regel.

Tijdzone is standaard Europe/Amsterdam, inclusief correcte zomer- en wintertijdafhandeling.

### Mobiel snelbeheer

Een bevoegde beheerder moet op een telefoon bijzonder eenvoudig de verzendtijd en aankomsttijd van de actieve ronde kunnen wijzigen.

Bied hiervoor een compact dashboard met grote tijdselecties en een duidelijke opslaanknop.

Controleer:

- Sluitingstijd ≤ verzendtijd.
- Verzendtijd vóór aankomsttijd.
- Voldoende voorbereidingstijd.
- Geen ongeldige wijziging nadat verzending heeft plaatsgevonden.

Als de aankomsttijd na verzending verandert, maak dan uitsluitend na expliciete bevestiging een duidelijk herkenbare correctiemail. Verstuur nooit opnieuw ongemerkt de volledige bestelling.

Log alle wijzigingen.

### Geen bestellingen

Wanneer niemand heeft besteld, sluit het systeem de ronde af zonder bestelling naar de cafetaria te mailen.

## 9. E-mailverzending

De applicatie gebruikt een afzonderlijk e-mailaccount voor uitgaande en inkomende berichten.

Alle SMTP-instellingen worden via de beheerderswebsite ingevoerd.

Ondersteun SMTP met TLS en veilige authenticatie. Ondersteun OAuth2 bij geschikte providers als dit betrouwbaar kan worden geïmplementeerd.

Sla credentials versleuteld op. Toon opgeslagen wachtwoorden en tokens nooit opnieuw in platte tekst.

De beheerder moet een testmail kunnen versturen naar een expliciet gekozen testadres.

### Uitnodigingsmails

Iedere actieve, niet-afwezige medewerker ontvangt een persoonlijke eenmalige bestellink.

### Persoonlijke bevestigingsmails

Na het plaatsen van een bestelling kan de medewerker een bevestigingsmail ontvangen.

Deze optie is **standaard ingeschakeld**, maar door de medewerker zelf uitschakelbaar.

De mail bevat de eigen bestelling, aantallen, bedragen en relevante planning.

Bij wijzigingen kan een nieuwe mail worden verstuurd met een duidelijke wijzigingsvermelding.

Verstuur geen nieuwe inlogtoken als onderdeel van de bestelbevestiging.

## 10. Definitieve e-mail naar de cafetaria

Dit onderdeel is bijzonder belangrijk.

Na sluiting en op het ingestelde verzendtijdstip verstuurt het systeem één duidelijk opgemaakte HTML-mail naar de cafetaria.

De mail krijgt een uniek bestelnummer, datum, gewenste aankomsttijd en totaalbedrag.

**De volgorde is verplicht:**

### Deel A — Totaaloverzicht voor de keuken

Helemaal bovenaan staat een overzicht van alle benodigde producten met de gezamenlijke aantallen.

Identieke producten met dezelfde relevante opties mogen worden samengevoegd. Verschillende varianten, sauzen of bereidingswensen moeten correct onderscheiden blijven.

Dit overzicht moet de cafetaria onmiddellijk kunnen gebruiken om met bereiden te beginnen.

### Deel B — Individuele bestellingen

Daaronder komt een overzicht per voornaam.

Bij iedere persoon staan:

- Producten.
- Aantallen.
- Relevante varianten en opmerkingen.
- Individuele prijzen.
- Totaalbedrag van de persoon.

Dit overzicht wordt gebruikt voor individuele betalingen of om per persoon bestellingen apart te houden.

De gezamenlijke aantallen en bedragen moeten exact overeenkomen met de onderliggende individuele bestellingen.

Gebruik één vaste, gevalideerde ordermomentopname voor beide overzichten.

De mail moet goed werken in Outlook, op mobiel en bij afdrukken op A4. Gebruik geen verplichte PDF-bijlage.

### Betrouwbare verzending

Een bestelmail mag niet onbedoeld meerdere keren worden verzonden.

Gebruik een persistente outbox, unieke verzendidentificatie, transactiegrenzen en idempotente verwerking waar mogelijk.

Omdat SMTP geen gegarandeerde end-to-end exactly-once-verzending biedt, moet een onzekere verzenduitkomst expliciet als **verzendstatus onbekend** worden geregistreerd.

In dat geval niet blind automatisch opnieuw verzenden, maar een bevoegde beheerder laten controleren.

## 11. Inkomende ontvangstbevestigingen

Het aparte e-mailaccount ontvangt ook reacties van de cafetaria.

Maak configureerbare instellingen voor inkomende e-mail via IMAP of een geschikte provider-API.

De applicatie controleert periodiek of er nieuwe bevestigingen zijn binnengekomen.

Probeer de juiste bestelronde te herkennen met:

- Het unieke bestelnummer.
- E-mailthreadheaders.
- Verwachte afzender.
- Betrouwbare inhoudsherkenning.

Voer geen code of instructies uit afkomstig uit e-mailinhoud. Beschouw alle inkomende mail als onbetrouwbare data.

Automatische bevestiging mag alleen plaatsvinden bij voldoende betrouwbare identificatie. Onzekere of verdachte reacties krijgen de status 'Handmatige beoordeling nodig'.

Maak onderscheid tussen:

- Gepland.
- Verzending bezig.
- Verzonden.
- Verzending onbekend.
- Verzending mislukt.
- Ontvangst bevestigd.
- Handmatige beoordeling nodig.
- Afgehandeld.
- Geannuleerd.

Bij het uitblijven van een bevestiging na een configureerbare periode, bijvoorbeeld 15 minuten, krijgt de coördinator een waarschuwing.

Dit mag niet automatisch tot een nieuwe bestelling leiden.

## 12. Betalingen

Maak betalingen volledig bankonafhankelijk.

Geen betaalde Tikkie API, bankkoppeling of ingebouwde betaalverwerking.

Er zijn twee hoofdwerkwijzen:

**A. Iedereen betaalt individueel bij de cafetaria.**

**B. Eén aangewezen persoon schiet de volledige bestelling voor en ontvangt later terugbetalingen.**

De betaalwijze is configureerbaar en kan eventueel per bestelronde verschillen.

### Betalingsverantwoordelijke

Voeg een aparte configureerbare rol toe.

Deze persoon kan:

- Het gezamenlijke bedrag zien.
- Per medewerker het verschuldigde bedrag bekijken.
- Met één klik het exacte bedrag kopiëren.
- Een overzicht van alle openstaande bedragen kopiëren.
- Handmatig bijhouden wie betaald heeft.
- Eventueel een algemene betaalverzoeklink toevoegen en delen.

Een medewerker ziet uitsluitend het eigen verschuldigde bedrag.

Een betalingsverantwoordelijke mag niet automatisch andere beheerrechten krijgen.

Ondersteun betaalverzoeken vanuit iedere bankapp. Geen verplichte Tikkie-branding.

Handmatig bijgehouden betaalstatussen zijn geen geverifieerde bankbetalingen. Maak dat onderscheid duidelijk.

## 13. Beheerdersomgeving

Bouw een professioneel desktop-first dashboard met minimaal de volgende onderdelen:

1. **Dashboard:** huidige ronde, aantal bestellingen, niet-deelnemers, afwezigen, ontbrekende reacties, totaalbedrag en systeemstatus.
2. **Bestelrondes:** planning, tijdstippen, handmatige rondes, annuleren, corrigeren en verzendstatus.
3. **Medewerkers:** medewerkers uitnodigen, beheren, deactiveren en aanwezigheid bekijken.
4. **Rollen en rechten:** rollen toevoegen, rechten instellen en beheeraccounts beheren.
5. **Menukaart:** scraperstatus, laatste synchronisatie, wijzigingen en foutmeldingen.
6. **E-mail:** SMTP, inkomende mailbox, ontvangers, testmails en e-mailsjablonen.
7. **Betalingen:** betalingsverantwoordelijke, bedragen en handmatige statussen.
8. **Instellingen:** algemene planning, privacy, bewaartermijnen en overige configuratie.
9. **Diagnostiek:** systeemcontroles en testfunctionaliteit.
10. **Auditlog:** kritieke beheeracties, wijzigingen en gebeurtenissen.

De rechten worden altijd server-side gecontroleerd. Alleen het verbergen van knoppen is onvoldoende.

Maak een duidelijke eerste-installatiewizard. Het aanmaken van de eerste beheerder mag niet openstaan voor willekeurige internetbezoekers. Gebruik een veilig, lokaal te initiëren, eenmalig bootstrapproces.

## 14. Beveiliging

Ontwerp volgens OWASP ASVS en actuele veilige ontwikkelpraktijken.

Minimaal:

- Verplichte MFA voor beheeraccounts.
- Sterke wachtwoordhashing, indien wachtwoorden worden gebruikt.
- Beveiligde sessies en sessierotatie.
- CSRF-bescherming.
- XSS- en injectiepreventie.
- Server-side autorisatie op iedere relevante actie.
- Rate limiting.
- Veilige HTTP-securityheaders en Content Security Policy.
- HTTPS-verplichting voor productie.
- Geen secrets in logs.
- Geen authenticatietokens in analytics of externe referers.
- Minimale database- en containerrechten.
- Encryptie van gevoelige configuratie.
- Auditlogging van kritieke gebeurtenissen.
- Veilige back-ups en herstel.
- Veilige verwerking van externe HTML en e-mail.
- Bescherming tegen SSRF bij scraper- en URL-configuratie.
- Dependency- en containerscans.
- Privacyvriendelijke, configureerbare gegevensretentie.

Houd rekening met AVG en BIO2-relevante uitgangspunten. Het gaat om gemeentelijke medewerkersgegevens op een privé-NAS: documenteer daarom dat organisatorische toestemming en privacy-/beveiligingstoetsing vóór echt productiegebruik nodig zijn.

Gebruik tijdens ontwikkeling uitsluitend testgegevens totdat deze randvoorwaarden zijn geregeld.

## 15. Testen

Testen is een verplicht onderdeel van de ontwikkeling, geen latere uitbreiding.

Gebruik unit-, integratie-, security- en Playwright-end-to-endtests.

Test minimaal:

- Installatie en migraties.
- Inloggen van beheerders en MFA.
- Uitnodigingen.
- Eenmalige tokens, verlopen tokens en gelijktijdig gebruik.
- E-mailscanners die een link vooraf openen.
- Aanvragen van nieuwe links.
- Rol- en rechtenbeveiliging.
- Gescheiden beheer- en medewerkersaccounts.
- Wijzigingen van persoonlijke gegevens.
- Unieke voornamen.
- Vakanties, pauzes en overslaan van rondes.
- Favorieten en alle drie categorieën.
- Zoeken binnen de huidige categorie.
- Bestellingen toevoegen en wijzigen.
- Gelijktijdige bestellingen.
- Deadlines en tijdzonewisselingen.
- Scraperuitval en gewijzigde prijzen.
- Betrouwbaarheid van de bestelbedragen.
- Geen bestellingen = geen mail naar cafetaria.
- Totale keukenlijst versus individuele bestellingen.
- SMTP-fouten, time-outs en onzekere verzendstatus.
- Geen onbedoelde dubbele verzending.
- Inkomende bevestigingen en verdachte e-mails.
- Correcties na verzending.
- Betalingsrechten en bedragen kopiëren.
- Back-up en herstel.
- Responsive weergave op iPhone, Android en desktop.

### Testmodus

De applicatie krijgt een veilige testmodus.

Een beheerder kan een volledige ronde simuleren met fictieve medewerkers.

Alle testmails gaan uitsluitend naar expliciet toegestane testadressen. De echte cafetaria mag nooit onbedoeld testbestellingen ontvangen.

Testconfiguratie en echte productieconfiguratie mogen niet door elkaar lopen.

Maak automatische GitHub Actions-controles die bij relevante wijzigingen worden uitgevoerd.

## 16. Projectstructuur en documentatie

Maak minimaal:

- `README.md` — installatie, beheer en deployment.
- `AGENTS.md` — permanente instructies voor alle toekomstige Codex-wijzigingen.
- `compose.yaml` — productiegerichte Portainer-stack.
- `Dockerfile` — veilige multi-stagebuild.
- `.gitignore` — veilige uitsluitingen.
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/REQUIREMENTS.md`
- `docs/DEPLOYMENT.md`
- `docs/TESTING.md`
- `docs/BACKUP_RESTORE.md`
- `docs/DECISIONS.md`

Voeg documentatie toe over rollen, e-mailconfiguratie, scrapen, de bestelstatusmachine, foutafhandeling en het beheren van de applicatie.

Geen wachtwoorden, echte medewerkersgegevens of andere geheimen in de publieke repository.

### AGENTS.md

Deze moet expliciet vastleggen dat toekomstige Codex-agents:

- Eerst de bestaande architectuur en documentatie lezen.
- Beveiliging boven functionaliteit stellen.
- De scheiding tussen beheeraccounts en medewerkers respecteren.
- Nooit functionele instellingen naar Docker Compose verplaatsen.
- Geen app/PWA-functionaliteit introduceren.
- De cafetaria als enige bron voor producten en prijzen behandelen.
- Geen betaalde betaaldienst toevoegen.
- Geen wijzigingen in bestel- of e-mailprocessen doorvoeren zonder relevante tests.
- Databasewijzigingen via migraties uitvoeren.
- Bestaande gegevens en compatibiliteit beschermen.
- Nooit beweren dat tests zijn geslaagd zonder ze uit te voeren.
- Bij iedere functionele wijziging documentatie en tests bijwerken.

## 17. Ontwikkelaanpak

Werk zelfstandig in logische fasen.

**Fase 1 — Technische basis en externe haalbaarheid**

Controleer de repository, leg de architectuur vast, onderzoek de menukaartbron en de mogelijkheden voor inkomende bevestigingsmails.

Gebruik mocks voor onzekere externe afhankelijkheden. Verzin geen live-scraperresultaten of echte bevestigingen.

**Fase 2 — Fundament**

Implementeer database, migraties, Docker, beveiligde installatie, authenticatie, MFA, RBAC en configuratiebeheer.

**Fase 3 — Medewerkerswebsite**

Implementeer uitnodigingen, magic links, profielen, afwezigheid, menukaart, favorieten, zoeken, winkelmandje en bestellingen.

**Fase 4 — Automatisering**

Implementeer planning, scraping, bestelrondes, mailverzending, ontvangstbevestigingen en foutafhandeling.

**Fase 5 — Beheer en betalingen**

Implementeer het complete dashboard, snelbeheer, betalingsverantwoordelijke, bedrag kopiëren, diagnostiek en auditlogs.

**Fase 6 — Productieklaar maken**

Testen, beveiligingsaudits, documentatie, back-ups, GitHub Actions en Docker-deployment.

Elke fase moet voortbouwen op werkende code. Gebruik waar mogelijk een verticale, volledig geteste end-to-endflow in plaats van veel onafgemaakte schermen.

## 18. GitHub-werkwijze

Gebruik de repository:

https://github.com/rjgout/smikkelbeer

Initialiseer de lege repository veilig en werk met duidelijke commits. Gebruik waar mogelijk een ontwikkelbranch en pull request.

Configureer GitHub Actions voor:

- TypeScript- en lintcontroles.
- Unit- en integratietests.
- Playwright-tests.
- Beveiligings- en dependency-scans.
- Docker-buildvalidatie.
- Publiceren van geteste Docker-images naar GHCR.

Voorkom dat mislukte tests leiden tot een als productierijp aangeduid image.

Documenteer hoe een nieuwe imageversie via Portainer wordt uitgerold en teruggedraaid.

Force-push niet en voer geen onomkeerbare wijzigingen uit zonder noodzaak.

## 19. Acceptatiecriteria

De applicatie is pas functioneel afgerond wanneer:

1. Een beheerder de website veilig kan installeren en configureren.
2. Alle functionele instellingen via de backend bereikbaar zijn.
3. Een bevoegde gebruiker een medewerker kan uitnodigen.
4. Een medewerker via een eenmalige link kan inloggen.
5. De medewerker favorieten en producten kan selecteren.
6. De bestelling veilig opgeslagen en later gewijzigd kan worden.
7. Deelname en afwezigheid correct worden verwerkt.
8. De menukaart betrouwbaar wordt opgehaald en gevalideerd.
9. Een ronde automatisch kan openen en sluiten.
10. Een ronde zonder bestellingen geen cafetariamail genereert.
11. Een gevulde bestelling één volledige keuken- en kassa-e-mail oplevert.
12. Inkomende bevestigingen veilig aan rondes kunnen worden gekoppeld of voor beoordeling worden aangeboden.
13. De betalingsverantwoordelijke bedragen kan kopiëren.
14. De beheerder op mobiel verzend- en aankomsttijd kan aanpassen.
15. Onbevoegde gebruikers geen beheer- of persoonsgegevens kunnen benaderen.
16. Alle relevante automatische tests slagen.
17. De Docker-stack volgens documentatie op een Synology met Portainer kan worden uitgerold.
18. Back-ups en herstel zijn getest.

## 20. Begin nu

Start direct met de implementatie.

Onderzoek eerst wat technisch aantoonbaar mogelijk is en bouw daarna de werkende basis.

Neem geen genoegen met alleen een README, mockup of projectplan. Ik wil echte werkende functionaliteit, tests en een Docker-image.

Werk zoveel mogelijk zelfstandig door. Als een externe afhankelijkheid nog niet definitief kan worden gevalideerd, implementeer dan een veilige adapter met tests en rapporteer duidelijk wat nog moet worden gecontroleerd.

Aan het einde rapporteer je:

- Welke onderdelen daadwerkelijk zijn gebouwd.
- Welke tests zijn uitgevoerd en geslaagd.
- Welke functionaliteit nog ontbreekt.
- Welke externe afhankelijkheden nog niet zijn geverifieerd.
- Welke beveiligingsrisico's nog openstaan.
- Hoe ik de applicatie op mijn Synology via Portainer kan starten.
- Welke eerste installatiestappen ik zelf moet uitvoeren.

**Belangrijk: een draaiende container is niet automatisch een veilige of productieklare applicatie. Claim dat pas wanneer de relevante beveiligingscontroles en acceptatietests aantoonbaar zijn geslaagd.**

Bouw Smikkelbeer als een zelfstandig, betrouwbaar, toekomstbestendig project. Begin nu.
