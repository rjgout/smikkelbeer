# Smikkelbeer: permanente werkinstructies

Lees eerst README.md, docs/ARCHITECTURE.md, docs/SECURITY.md en docs/REQUIREMENTS.md.
Beveiliging gaat boven functionaliteit. Markeer onvoltooide acceptatiecriteria eerlijk.

- Beheeraccounts en medewerkers zijn strikt gescheiden. Een beheerder bestelt alleen via een afzonderlijk medewerkersaccount.
- Autoriseer iedere actie server-side; behoud MFA, tokenhashing, anti-replay, CSRF en accountscheiding.
- Verplaats functionele instellingen nooit naar Compose of omgevingsvariabelen. Alleen infrastructuur hoort daar.
- Introduceer geen app, Capacitor, PWA, manifest of serviceworker.
- Alleen https://www.hetcentrummarum.nl is product-, optie- en prijsbron. Geen handmatige producten of stille verouderde fallback.
- Geen betaalde betaaldienst, Tikkie-API of bankkoppeling.
- Wijzig bestel- en e-mailprocessen uitsluitend met relevante tests. SMTP-onzekerheid betekent handmatige controle, geen automatische retry.
- Databasewijzigingen uitsluitend via opeenvolgende migraties. Bestaande data, snapshots, compatibiliteit en herstel beschermen.
- Nooit secrets of persoonsgegevens in logs, fixtures, screenshots, commits of PR's. Test met fictieve medewerkers.
- Nooit beweren dat tests slagen zonder ze daadwerkelijk uit te voeren.
- Werk bij iedere functionele wijziging documentatie en tests bij.
- Start geen extra applicatieprocessen op hetzelfde datavolume; de scheduler en SMTP-worker zijn voor één replica ontworpen.
- De oorspronkelijke masteropdracht staat in docs/MASTERPROMPT.md; behoud expliciete veiligheidsblokkades bij onzekere externe koppelingen.

## Menukaartsynchronisatie (achtergrondtaken)

- Start bronwerk vanuit HTTP uitsluitend via een persistente taak en antwoord direct met HTTP 202. Wacht in API-routes nooit op `syncMenu()`, `createRound()` met broncontrole of `finalizeRound()`.
- Gebruik de bestaande worker, SQLite-unique-index en werklease met fencing. Introduceer geen losse fire-and-forget-scrapers of alleen een in-memory lock.
- Publiceer uitsluitend een volledig gevalideerde menukaart in één transactie. Wijzig bestaande succesvolle catalogi of onveranderlijke ronde-snapshots nooit bij fouten of herstel.
- Behoud minimaal 1000 ms tussen optievensters, de ingestelde hogere vertraging en minimaal 60 seconden na afronding/onderbreking. Een afgebroken browserrequest mag geen taak annuleren of automatisch opnieuw starten.
- Bewaar voortgang en diagnose bij herstart. Onderbroken draaiende taken worden gemarkeerd; alleen nog niet gestarte wachtrijtaken mogen normaal na herstart starten. Back-upherstel onderbreekt ook wachtrijtaken.
- Behoud autorisatie, CSRF, brongoedkeuring, grenzen op URL/antwoordgrootte en veilige Nederlandse foutmeldingen. Toon nooit ruwe proxy-HTML, credentials of willekeurige transportfouten.
- Test wijzigingen met virtueel langlopende taken, gelijktijdige starts, bronfouten, verloren werkleases/herstarts, HTTP-524/HTML en Playwright-polling. Laat de live bronproef alleen expliciet en éénmaal per relevante wijziging lopen om de cafetaria te ontzien.

- Ronde-aanmaak hergebruikt uitsluitend de laatste geslaagde, integere momentopname van maximaal 30 minuten oud; een latere bronfout mag niet worden overgeslagen. Een gevulde ronde vereist vóór verzending altijd een nieuwe volledige broncontrole.
- Handmatige ronde-aanvragen gebruiken een persistent aanvraag-ID met transactionele deduplicatie en een geautoriseerd herstel-statusendpoint. Herhaal onzekere POSTs nooit automatisch; gebruik hetzelfde ID bij een expliciete herhaling.
- Bouw HTML-datums expliciet als YYYY-MM-DD uit kalenderdelen in Europe/Amsterdam; vertrouw niet op de weergavevolgorde van een locale zoals en-CA.
