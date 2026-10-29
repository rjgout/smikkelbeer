# Smikkelbeer

Responsive snackbestelwebsite voor Team Informatie & Automatisering, Gemeente Westerkwartier. Producten en prijzen komen uitsluitend van Cafetaria ’t Centrum in Marum.

**Status: werkende eerste implementatie voor acceptatietesten, geen vrijgegeven productieapplicatie.** Externe mailproviders, volledige brondekking, gemeentelijke toestemming en deployment op de echte Synology zijn nog niet geverifieerd. Zie [open punten en acceptatiecriteria](docs/REQUIREMENTS.md).

## Lokaal ontwikkelen

Node 24.15+ en npm zijn vereist. Geen externe database, app of PWA.

```sh
npm ci
npm run dev
# In een tweede terminal, na de eerste serverstart:
npm run bootstrap
```

Open http://localhost:5173/setup, voer de lokaal gegenereerde installatiecode in, maak een sterk beheerderswachtwoord en koppel TOTP. De installatiecode en MFA-sleutel zijn geheim. Alleen de ontwikkelserver staat HTTP toe.

Na installatie: open Beheer → Instellingen, stel publieke HTTPS-URL, planning, SMTP, IMAP, ontvangers, bewaartermijn en toegestane testadressen in. De testmodus staat standaard aan. De menukaartsynchronisatie staat uit totdat brongebruik en voorwaarden zijn beoordeeld. Opgeslagen mailcredentials worden nooit teruggestuurd naar de browser.

## Tests

```sh
npm run check
npm run lint
npm test
npx playwright install --with-deps chromium webkit
npm run test:e2e
npm audit --audit-level=low
BUILDING=1 npm run build
```

Playwright start een eigen server en gebruikt alleen fictieve medewerkers in `.e2e-data/`. Unit- en integratietests gebruiken tijdelijke SQLite-databases. De tests versturen geen echte e-mail en veranderen de officiële cafetariabestellingen niet.

## Synology / Portainer

Gebruik [compose.yaml](compose.yaml) als Git-stack. De Git-branch van deze eerste implementatie gebruikt het geteste `preview`-image; publicatie vindt pas plaats als alle CI-poorten slagen. Een image is niet automatisch productiegeschikt. Zie [deployment](docs/DEPLOYMENT.md), [back-up/herstel](docs/BACKUP_RESTORE.md), [beveiliging](docs/SECURITY.md) en [beheer](docs/OPERATIONS.md).

De stack heeft één niet-root applicatiecontainer, persistent `/data`, een alleen-lezen rootbestandssysteem en een alleen op loopback gepubliceerde poort 3080. Sluit de bestaande HTTPS-reverse-proxy daarop aan. Laat de proxy `X-Forwarded-Proto` en `X-Forwarded-Host` overschrijven. Geen functionele instellingen of wachtwoorden in Compose.

```sh
docker compose up -d
docker compose exec smikkelbeer node scripts/bootstrap.mjs
```

Bezoek daarna `/setup` via HTTPS. Een nieuw datavolume genereert automatisch een encryptiesleutel. Database **en** sleutel moeten samen worden geback-upt.

## Documentatie

- [Architectuur](docs/ARCHITECTURE.md), [technische keuzes](docs/DECISIONS.md)
- [Eisen en ontbrekende functionaliteit](docs/REQUIREMENTS.md)
- [Beveiliging en privacy](docs/SECURITY.md)
- [Deployment en rollback](docs/DEPLOYMENT.md)
- [Testaanpak en resultaten](docs/TESTING.md)
- [Beheer, rollen, mail, bron en statussen](docs/OPERATIONS.md)
- [Back-up en herstel](docs/BACKUP_RESTORE.md)
- [Oorspronkelijke opdracht](docs/MASTERPROMPT.md)
