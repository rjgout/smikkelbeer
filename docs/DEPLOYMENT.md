# Synology DS1520+ en Portainer

## Voorwaarden

Docker/Container Manager met Compose, amd64, bestaand HTTPS-domein/reverse proxy of Cloudflare Tunnel en een beveiligde Portainer-installatie. Eén applicatie-replica en een persistent Docker-volume. Geen Synology-API nodig.

De standaardstack gebruikt `ghcr.io/rjgout/smikkelbeer:preview`. Dit image bestaat pas na een geslaagde GitHub Actions-publicatie. Controleer de Actions-run en Packages-pagina. De testbranch publiceert `preview` en een onveranderlijke `sha-<commit>`-tag; main publiceert pas na dezelfde controles `latest`. Gebruik voor gecontroleerde uitrol bij voorkeur een geverifieerde image-digest. Preview is uitsluitend voor acceptatietesten.

## Portainer Git-stack

1. Stacks → Add stack → Repository: `https://github.com/rjgout/smikkelbeer`, referentie `refs/heads/codex/smikkelbeer` voor de eerste implementatie, Compose path `compose.yaml`.
2. Controleer dat het bijbehorende GHCR-package openbaar leesbaar is. Bij een privé-package heeft Portainer een registrycredential met uitsluitend `read:packages` nodig.
3. Deploy de stack. De named volume krijgt UID 1000/GID 1000. Bij een bind mount moet je de map vooraf daarop zetten en chmod 0700 toepassen. De niet-root container wijzigt geen hostrechten.
4. Verbind de bestaande reverse proxy op de NAS met `127.0.0.1:3080`. Alleen HTTPS publiceren. De proxy moet `X-Forwarded-Proto: https` en `X-Forwarded-Host: jouw.domein` overschrijven. Accepteer geen onbeheerde clientversies van die headers.
5. Voor een tunnelcontainer op een apart netwerk: maak een gedeeld Docker-netwerk en routeer intern naar `smikkelbeer:3000`; publiceer poort 3000 niet algemeen. Pas netwerk-infrastructuur in de stack aan. Dit is netwerkconfiguratie, geen functionele applicatieconfiguratie.
6. Via de NAS-terminal (of Portainer met aangepaste Node-console), gebruiker 1000: `/nodejs/bin/node scripts/bootstrap.mjs`. Kopieer de eenmalige code uitsluitend naar de eigen browser.
7. Open `https://jouw.domein/setup`. Maak beheeraccount, wachtwoord en TOTP. Koppel een tweede volledig beheerder zodra mogelijk.
8. Beheer → Instellingen: werkelijke publieke URL, testontvangers, SMTP/IMAP, coördinator/cafetaria, planning en retentie instellen. Alle functionele instellingen blijven in de beveiligde website. Testmodus blijft aan.
9. Beoordeel toestemming/voorwaarden van de bron, zet synchronisatie aan en controleer complete product-/optiedekking. De bron kan enkele minuten verwerking vereisen. Er worden geen bestellingen op de bronwebsite geplaatst.
10. Test een volledige ronde met fictieve medewerkers, testmail, echte providerreactie, onzekerheidsafhandeling en back-up/herstel. Zet productie pas na de open acceptatie- en beveiligingscontroles aan.

## Updates

Maak vóór iedere update een consistente back-up inclusief sleutel. Noteer de oude image-digest, pin de nieuwe geteste digest in Portainer en recreate uitsluitend de container; verwijder nooit het volume. Migraties draaien transactioneel bij opstart. Controleer healthcheck, login, bronstatus, scheduler en mailbox. Plan updates buiten een verzendmoment.

## Rollback

Een oudere image gebruiken is alleen veilig als de databaseversie compatibel is. Bij onverenigbare migraties: stop de stack, bewaar het huidige volume als incidentkopie, herstel database én sleutel naar een leeg volume vanaf de pre-updateback-up en start de oude digest. Herstelde pending/sending-mails staan bewust op onbekend; controleer de echte mailbox voordat je handmatig afrondt. Nooit automatisch opnieuw bestellen na herstel.

## Diagnose

`/api/health` controleert de database; het is geen volledige readinesscontrole van SMTP, bron of privacygoedkeuring. Gebruik Beheer → Diagnostiek en Auditlog. Bij verkeerde publieke URL kan een volledige beheerder eerst via de nog geldige origin instellingen corrigeren; bij DNS-verhuizing behoud je die origin tijdelijk. Er is bewust geen onbeveiligde URL-resetroute.

Het runtime-image is distroless (Node 24/Debian 13): geen shell, npm of package manager. Gebruik in de NAS-terminal `docker compose exec smikkelbeer /nodejs/bin/node scripts/bootstrap.mjs`. In Portainer kan een aangepaste console `/nodejs/bin/node` openen; voer daar `await import('./scripts/bootstrap.mjs')` uit. Gebruik nooit een onbeveiligde webroute voor bootstrap.

## Update voor achtergrond­synchronisatie

Behoud het bestaande datavolume, haal het nieuwe geteste preview-image op en recreate de container. Migratie 004 behoudt bestaande catalogi en orders en voegt persistente synchronisatietaken toe. Ververs de beheerpagina na de update. Er zijn geen nieuwe functionele Compose-instellingen en geen hogere Cloudflare-timeouts nodig. Bronverzoeken blijven even voorzichtig gedoseerd. Zie MENU_SYNC.md voor diagnose, voortgang, foutcodes en herstartgedrag.

Ronde-aanmaakherstel vereist het nieuwe image met migratie 005 én de nieuwe beheerbundel. Trek preview opnieuw op, recreate met behoud van /data en herlaad de beheerpagina volledig. Alleen een bijgewerkte PR of een oud image opnieuw starten installeert de fix niet. Controleer in de browser dat een verse menukaart tot een korte create-POST (201) leidt; een oudere menukaart levert 202 met voortgang op.
