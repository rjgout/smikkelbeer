# Eisen en acceptatiestatus

De oorspronkelijke opdracht staat in MASTERPROMPT.md. Status: implementatie voor acceptatietesten, geen productievrijgave.

| Onderdeel | Gebouwd | Open acceptatie of ontbrekend |
|---|---|---|
| Basis | SvelteKit/TypeScript, SQLite, transactionele migraties, Docker/Compose | Synology/Portainer-uitrol op doelhardware |
| Accounts | Lokaal geïnitieerde bootstrap, verplichte MFA, gescheiden sessies, RBAC, beschermde systeemrollen en laatste beheerder, custom rollen | Herstelwizard voor verlies van alle MFA-middelen ontbreekt |
| Medewerkers | Uitnodigen/deactiveren, unieke voornamen, profiel, geverifieerde e-mailwijziging, vakantie/pauze/overslaan | AVG-export/verwijderwizard ontbreekt |
| Links | Willekeurige gehashte tokens, expiry, atomische single-use, GET-safe, expliciete POST, neutraal aanvragen, limieten, intrekken | Echte Safe Links/mailgateway testen |
| Bestellen | Drie categorieën, categoriezoeken, favorieten, opties/notities/aantallen, serverprijzen, revisies/deadlines, geschiedenis | Complete optiecombinaties als favoriet ontbreken |
| Menukaart | Vaste officiële bron, HTML-/optieadapter, beschikbaarheid, stabiele IDs, foutdetectie/historie, immutable snapshots, controles vóór openen/verzenden | Technische live controle geslaagd: 213 producten en 211 beschikbare optievensters. Handmatige inhoudsvergelijking en toestemming/voorwaarden nog open; synchronisatie standaard uit |
| Planning | Amsterdam/DST, weekdays/uitzonderingen, automatische/handmatige rondes, meerdere niet-overlappende vensters per dag, herinneringen, annuleren, mobiel tijdbeheer | Operationele providerketen testen |
| SMTP | TLS/STARTTLS, versleutelde settings, testlijst, uitnodigingen, bevestigingen, keuken vóór individuen, correctie, persistente outbox/deduplicatie/onzekerheid | Echte provider en Outlook/A4 niet geverifieerd; OAuth2 ontbreekt; geen vrijgegeven retryflow voor bestelmail |
| IMAP | TLS, begrensd ophalen, thread/nummer/afzender/inhoud als beoordelingshulp, reviewlijst, handmatig bevestigen, waarschuwingen | Altijd menselijke beoordeling; automatische bevestiging vereist betrouwbaar providerbewijs |
| Betalingen | Onafhankelijk van bank, aparte rol, kopiëren, handmatige status, algemene/per-ronde instellingen | Geen bankverificatie, zoals gevraagd |
| Beheer | Tien secties, audit, diagnostiek, instellingen, fictieve bestelsimulatie | Onafhankelijke gebruiks- en toegankelijkheidstest |
| Beveiliging | MFA/sessies, CSRF, XSS/SQL-preventie, rate limits, CSP/headers, HTTPS, encryptie, SSRF-begrenzing, niet-root | Pentest/ASVS/BIO2/AVG-toets en organisatorische toestemming; open low-severity builddependency-melding |
| Back-up | Online consistente SQLite-back-up met sleutel/manifest, herstel naar lege map, intrekken sessies/tokens en blokkeren onzekere mails | Eigen NAS-hersteloefening en externe versleutelde back-upplanning; sleutelrotatie ontbreekt |
| CI/GHCR | Type/lint/unit/integratie/Playwright, dependency/CodeQL/containerscan, publicatie na geslaagde controles | Controleer daadwerkelijke Actions-run en package-toegang |

Alle 18 oorspronkelijke acceptatiecriteria blijven bindend. Automatische tests bewijzen delen daarvan, geen externe keten. Gebruik uitsluitend fictieve gegevens totdat de organisatie, volledige brondekking, providers, deployment en herstel zijn goedgekeurd en getest.
