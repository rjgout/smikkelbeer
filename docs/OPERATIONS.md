# Beheerhandleiding

## Rollen

Volledige beheerder heeft alle rechten, inclusief instellingen en rollen. Systeemrollen zijn beschermd. Bestelcoördinator: `rounds`, `employees`, `menu`, `mail`. Betalingsverantwoordelijke: uitsluitend `payments`. Custom rollen krijgen expliciete rechten uit de vaste lijst. Alleen een volledige beheerder beheert roltoewijzingen en andere beheerders. Laatste volledige beheerder kan niet worden gedeactiveerd of gedegradeerd. Maak deelnemers apart aan via Medewerkers.

## E-mail

Stel SMTP TLS 465 of verplicht STARTTLS 587 in. IMAP gebruikt 993/TLS. Alleen publieke IPv4-mailservers worden ondersteund. Geen OAuth2 in deze versie. Gebruik een eigen mailbox en providergoedgekeurd app-wachtwoord. Wachtwoorden leeg laten bij opslaan behoudt de bestaande waarde. Opgeslagen waarden worden nooit opnieuw weergegeven.

Testmails vereisen een expliciet gekozen adres op de testlijst. Het cafetaria-adres kan niet op die lijst staan. De eerste testontvanger ontvangt een verzamelde testbestelling. Persoonlijke testmails naar andere adressen zijn geblokkeerd; gebruik fictieve deelnemers met het toegestane testadres of schakel bevestigingen voor simulatieaccounts uit. In testmodus mogen alleen de expliciet toegestane adressen aflevering krijgen, ook als de outbox vóór een moduswissel is gevuld.

Persoonlijke bevestigingsmails staan standaard aan. Uitnodigingen bevatten een fragmentlink en verlopen standaard na 15 minuten. Bevestigingen bevatten geen nieuwe inloglink. Bij een e-mailadreswijziging moet de medewerker de verificatielink vanuit de eigen sessie bevestigen.

## Bron

De officiële HTML bevat `.dish` met stabiele numerieke product-ID's, bedragen, categorieën en uitverkochte knoppen. Productopties worden via `/order/product/add/<id>` gelezen. De adapter accepteert bekende checkbox/radio-opties met optielimieten. Vereiste/nieuwe variantselecties of structuurwijzigingen blokkeren. Geen handmatig assortiment of prijzen.

De volledige broncontractdekking is nog niet live gecertificeerd. Robots.txt gaf tijdens onderzoek 404; dat is geen toestemming voor geautomatiseerd gebruik. Voorwaarden/toestemming moeten door de beheerder worden beoordeeld vóór activering. Houd de frequentie laag; geen anti-bot-, login- of CAPTCHA-omzeiling. Bij bronwijziging: fixtures/adapter bijwerken, testen en herbeoordelen.

## Statusmachine

`planned → open → closed → queued → sending → sent → confirmed → completed`.

Alternatieven: `cancelled` vóór verzending; `blocked` bij bronfout/prijswijziging; `failed` bij zeker mislukte aflevering; `unknown` bij time-out/crash/herstel; `review` bij inkomende mail. Een lege ronde gaat van gesloten naar afgehandeld zonder cafetariamail.

- `blocked`: bekijk Menukaart en corrigeer bronproblemen. Opnieuw controleren kan op het ingestelde verzendmoment. Bij gewijzigde snapshot: annuleer en maak met een nieuw niet-overlappend bestelvenster een nieuwe ronde; deelnemers bestellen en bevestigen opnieuw. Extra handmatige rondes op dezelfde dag zijn toegestaan; bestelvensters mogen niet overlappen. Automatische planning maakt maximaal één ronde per dag.
- `unknown`: controleer verzonden items en neem zo nodig contact op met de cafetaria. Leg de werkelijke uitkomst en onderbouwing vast bij de ronde. Geen automatische retry of knop die de volledige bestelling opnieuw verstuurt.
- `failed`: controleer provider/credentials. Niet-bestelmails met een zeker mislukte aflevering hebben een API voor expliciete retry. Voor cafetariamails is geen retryflow vrijgegeven; handel gecontroleerd af.
- Inkomende mail wordt uitsluitend ter beoordeling aangeboden, ook bij overeenkomstige afzender en bestelnummer. De coördinator bevestigt ontvangst na controle. Na de ingestelde termijn verschijnt een waarschuwing per mail/dashboard, nooit een nieuwe bestelling.
- Na verzending kan alleen aankomsttijd worden aangepast met expliciet aangevinkte bevestiging; er gaat een afzonderlijke correctiemail uit, geen kopie van de bestelling.

## Betalingen en deelname

Iedereen betaalt bij de cafetaria of één persoon schiet voor. De aparte betalingsrol ziet bedragen en kan individuele/openstaande bedragen kopiëren en handmatig betaald markeren. Geen bankverificatie of betaal-API. Betaalverzoeklinks openen alleen op initiatief van de medewerker; de server haalt ze niet op.

Afwezigheid heeft een inclusieve einddatum; deelname hervat automatisch. Pauzeren is vrijwillig en verhindert profieltoegang via een nieuw aangevraagde link niet. Deactiveren door beheer trekt alle sessies/links in en verhindert nieuwe toegang. Eén ronde overslaan onderdrukt uitnodigingen; expliciet geen snacks kiezen legt niet-deelname vast.
