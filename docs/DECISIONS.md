# Technische keuzes

- SvelteKit met één Node-container: één taal voor UI/API, geen extra database-, queue- of croncontainer.
- Native SQLite met expliciete SQL-migraties in plaats van een ORM: minimale runtime-afhankelijkheden, zichtbare constraints/transacties en geen native npm-addon. Node 24.15+ is vereist.
- Eigen klein CSS-componentensysteem: rustige groene/crèmekleurige interface, mobiele bestelstroom en brede beheertabellen, geen externe UI-bibliotheek.
- Scrypt uit Node in plaats van een extra wachtwoordlibrary. Verplichte TOTP, kortlevende gescheiden sessies, lokaal geïnitieerde bootstrap.
- Geheimen in AES-GCM onder een automatisch gegenereerde volumegebonden sleutel. Geen functionele omgevingsvariabelen; sleutels en database samen herstellen.
- Geen automatische goedkeuring van inkomende mails zonder providergebonden authenticiteitsbewijs. De geteste classificatie helpt alleen de menselijke beoordeling.
- Veilige, begrensde HTML-adapter voor de publiek zichtbare SiteDish-menukaart. Geen stabiele gedocumenteerde openbare API vastgesteld. Niet-ondersteunde opties stoppen synchronisatie.
- Bronwijzigingen blokkeren de volledige ronde. Correctie is annuleren en opnieuw laten bestellen tegen een nieuwe snapshot; geen ongemerkte prijswijzigingen.
- Geen automatische retry van cafetariamails. Ook SMTP exactly-once claimen we niet. Handmatige controle bij onzekerheid is verplicht.
- Testmodus standaard aan, expliciete testontvangers en nooit het cafetaria-adres. Fictieve rondes gebruiken uitsluitend producten uit een echte bronmomentopname.
- Eén replica: eenvoud voor Synology DS1520+, geen claim van HA. Scheduler/workerverdeling bij opschalen vereist aanvullend ontwerp.
- GitHub Actions publiceert pas na type-, lint-, unit-, integratie-, browser-, dependency- en containerscans. Preview is geen productiecertificering.

- Runtime: distroless Node 24 op Debian 13, zonder npm/shell/package manager. Het oorspronkelijke Debian 12-image had blokkerende OS- en meegeleverde npm-meldingen; de securitypoort is gehandhaafd. Beheerscripts worden rechtstreeks met `/nodejs/bin/node` uitgevoerd.
