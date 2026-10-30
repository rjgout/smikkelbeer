# Geplande rondes op de medewerkerswebsite

De medewerkerswebsite toont de eerstvolgende relevante ronde: een huidig bestelvenster, anders de eerstvolgende geplande ronde, anders de laatst gesloten ronde. De kaart vermeldt datum, bestellen vanaf/tot, verwachte aankomst en Binnenkort, Bestellen geopend of Gesloten. Toekomstige rondes staan op openingstijd; maximaal twaalf relevante vensters worden opgehaald. Geannuleerde rondes worden niet als toekomstige ronde getoond. Zonder bekende ronde verschijnt een duidelijke lege status. Test-rondes behouden hun eigen testmarkering.

## API en privacy

`GET /api/employee` blijft de eigen profiel-/bestelgegevens geven en voegt `timeline` toe. Alleen wanneer het servervenster open is, bevat `round` de bestaande onveranderlijke menukaartmomentopname. Voor opening worden geen producten, opties of snapshot vrijgegeven.

`GET /api/employee/rounds` is het lichte statusendpoint. Het vereist een actieve medewerkerssessie en retourneert `serverNow`, `active`, `upcoming` en `recent`. De rondeprojectie is expliciet beperkt tot ID, bestelnummer, datum/tijden, status, testmarkering en eigen uitnodigingsstatus. Geen snapshot, digest, interne diagnose, beheerinstellingen, andere medewerkers of andere bestellingen. `recent.order` bevat uitsluitend de eigen bestellingsregels/bedragen/status. Een meegegeven medewerker-ID selecteert nooit een andere identiteit. Een beheerderssessie geeft geen medewerkerstoegang. Alle responses blijven no-store.

## Bestelvenster en scheduler

Een gedeelde tijdcontrole wordt voor weergave én `saveOrder()` gebruikt. Een reeds gevalideerde ronde met opslagstatus `planned` of `open` is uitsluitend bestelbaar als `opens <= serverNow < closes`. Dit voorkomt dat een vertraagde scheduler-tik de interface onnodig gesloten houdt. De status in SQLite wordt niet door een GET gewijzigd; de bestaande scheduler blijft uitnodigingen en vervolgstappen verwerken. Geannuleerde, geblokkeerde, gesloten of verder verwerkte rondes worden nooit heropend door alleen de kalender. Geen menukaartsynchronisatie of mail wordt door statusopvragen gestart.

De server berekent prijzen, opties en beschikbaarheid nog steeds uit de vaste ronde-snapshot en controleert identiteit, revisie en deadlines bij iedere wijziging. Een oude browserpagina, vervalste klok of handmatige POST kan geen vroege/late bestelling plaatsen. De volledige broncontrole vóór verzending, testidentiteit, outbox en CSRF veranderen niet.

## Lichte verversing

De zichtbare pagina haalt normaal eens per dertig seconden alleen rondestatus op; zonder actieve/geplande ronde eens per minuut. Hij plant daarnaast een controle op de bekende opening/sluiting. Producten en bestelgeschiedenis worden alleen bij eerste laden, een verandering van actieve ronde of na een expliciete bestelling opgehaald. Gewone polling overschrijft geen onopgeslagen mandje of profielvelden.

De browser gebruikt de ontvangen servertijd en een monotone klok, met conservatieve correctie voor requestduur. Bij de bekende sluiting verdwijnt de bestelinterface meteen, ook als een statusrequest traag is; een bekende eigen bestelling blijft leesbaar. De apparaatklok en locale datumvolgorde bepalen geen bestelrecht. Alle datum-/tijdweergave gebruikt Europe/Amsterdam; absolute tijdstippen maken zomer-/wintertijdgrenzen eenduidig.

Er is maximaal één achtergrondverzoek tegelijk met een timeout van tien seconden. Bij een fout volgt een vriendelijke melding en oplopende herhaalpauze tot zestig seconden; bekende tijdgrenzen blijven gelden. Verborgen tabs pollen niet. Bij terugkeer, focus of hervatten van een pagina volgt opnieuw een controle; tijdens onzekere hervatting wordt bestellen eerst geblokkeerd. Timers/verzoeken worden bij verlaten opgeruimd. Geen countdown, serviceworker, PWA of nieuwe Compose-instelling.

## Deelname

Pauzeren, een ronde overslaan en afwezigheid (inclusief de einddatum) worden bij de ronde uitgelegd. De voorkeuren blijven ongewijzigd; voor de eerstvolgende ronde kan de medewerker in Mijn profiel uitnodigingen overslaan. Zoals voorheen regelen deze voorkeuren uitnodigingen. Een medewerker die zelf binnen het geldige venster expliciet bestelt, blijft daartoe bevoegd; dit zet de uitnodigingsvoorkeur niet terug. “Deze keer geen snacks” blijft een afzonderlijke expliciete registratie.

## Acceptatie op Synology

1. Trek na geslaagde CI het nieuwe preview-image op, recreate met behoud van /data en herlaad de medewerkerspagina volledig. Er is voor deze wijziging geen nieuwe migratie of Compose-instelling.
2. Maak in testmodus een gevalideerde ronde met een korte toekomstige opening. Log in met een afzonderlijk fictief medewerkersaccount. Controleer datum/tijden, testrondemarkering en de uitgeschakelde knop vóór opening.
3. Laat dezelfde pagina open tot opening. Controleer dat producten, categorieën en favorieten vanzelf verschijnen. Sla een fictieve bestelling op; gewone statusverversing mag een nog onopgeslagen wijziging niet wissen.
4. Laat de pagina open tot sluiting. Bestellen/wijzigen moet verdwijnen, de eigen ingediende bestelling blijft leesbaar en een eventuele volgende ronde staat in beeld. Controleer ook een oude tab en terugkeer na schermvergrendeling op iPhone/Safari.
5. Annuleer een toekomstige ronde in beheer en controleer dat deze bij verversing verdwijnt. Controleer meerdere geplande vensters in de juiste volgorde.
6. Controleer pauze, vakantie op begin-/einddatum en één ronde overslaan. De kaart moet dit uitleggen zonder de opgeslagen keuze te wijzigen. Controleer ook de lege status zonder toekomstige rondes.
7. Controleer met een ander fictief account dat uitsluitend de eigen bestellingen zichtbaar zijn en dat uitgelogd geen rondegegevens worden teruggegeven. Voer fysieke iPhone-/Android- en toetsenbord/screenreader-acceptatie uit; browseremulatie vervangt dit niet.
