# Back-up en herstel

Een databasekopie zonder `master.key` kan versleutelde configuratie, TOTP en uitgaande berichten niet herstellen. Bewaar beide samen en versleutel de back-up buiten het applicatiedatavolume. Roottoegang tot database en sleutel geeft toegang tot persoonsgegevens en credentials.

## Back-up

Het script gebruikt SQLite's online backup-API, geen onbetrouwbare live kopie van het hoofdbestand terwijl WAL actief is.

```sh
docker compose exec smikkelbeer /nodejs/bin/node scripts/backup.mjs /tmp/smikkel-backup
# Kopieer de map uit de container naar een beveiligde locatie voordat de container verdwijnt.
docker cp CONTAINERNAAM:/tmp/smikkel-backup ./smikkel-backup
```

`/tmp` is beperkt tot 32 MiB: voor grotere databases mount je een extra uitsluitend infrastructureel back-updoel en geef je dat pad mee. Laat een NAS-beheertaak dagelijks een nieuwe back-up maken en extern versleuteld bewaren. De huidige applicatie heeft geen ingebouwde externe back-upplanner of sleutelrotatie. Stel verantwoordelijkheid en hersteldoelen vast; test herstel periodiek.

De back-up bevat `smikkelbeer.sqlite`, `master.key` en `manifest.json` met checksums. Checksums detecteren corruptie, bieden geen bewijs tegen doelbewuste manipulatie; bescherm de back-uplocatie en gebruik geauthenticeerde encryptie door de beheerorganisatie.

## Herstellen

1. Stop de applicatie en bescherm het huidige volume als incidentkopie.
2. Gebruik een lege doelmap/nieuw volume met UID 1000/GID 1000 en veilige rechten. Overschrijf geen bestaande draaiende database.
3. Start een eenmalige container met de juiste imageversie, de back-up alleen-lezen en het lege doelvolume op `/data`:

```sh
docker run --rm --user 1000:1000 \
  -v NIEUW_VOLUME:/data -v /veilig/backup:/restore:ro \
  --entrypoint /nodejs/bin/node ghcr.io/rjgout/smikkelbeer:GEVERIFIEERDE_TAG \
  scripts/restore.mjs /restore
```

4. Het script controleert checksums en database-integriteit, kopieert de twee bestanden en trekt sessies, magic links en bootstrapcodes in. Mogelijk verzonden mails worden `unknown`, ook als ze in de back-up nog pending waren.
5. Start precies één applicatie, verifieer de publieke URL, MFA, instellingen, rondes, bestellingen en mailbox. Controleer alle onzekere verzendingen; geen blinde retry.

## Getest

De automatische integratietest maakt een live SQLite-back-up, herstelt naar een nieuwe map, vergelijkt de sleutel, controleert data en ingetrokken tokens en verifieert dat herstel naar een niet-lege map wordt geweigerd. Dit vervangt geen hersteloefening op de eigen NAS met de echte provider.
