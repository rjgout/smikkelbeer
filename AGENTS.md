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
