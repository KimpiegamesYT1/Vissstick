# Vissstick Discord Bot 🐔

Discord bot voor het HOK van Syntaxis.

## Features

- **Hok Monitoring** - Realtime status of het hok open/dicht is met tijdsschatting
- **Dagelijkse Quiz** - Elke dag om 7:00 een nieuwe vraag, antwoord om 17:00
- **Maandelijks Scoreboard** - Overzicht van quiz scores aan het einde van de maand
- **Chat Responses** - Automatische grappige reacties

## Installatie (Server)

```bash
# Download en start met het startscript
curl -O https://raw.githubusercontent.com/KimpiegamesYT1/Vissstick/main/startscript
chmod +x startscript
./startscript
```

Het startscript regelt automatisch:
- Clonen/updaten van de repository
- Database backups
- Dependencies installeren
- Migratie van oude data

## Lokaal draaien

```bash
npm install
cp config.example.json config.json
# Vul je config.json in
npm start
```

## Configuratie

Zie `config.example.json` voor de benodigde instellingen.

## Quiz vragen toevoegen (import)

De bot kan automatisch nieuwe vragen importeren uit `quiz-import.json` in de projectroot.

- Bij bot startup:
	- Als `quiz-import.json` niet bestaat: de bot maakt automatisch een lege `[]` aan.
	- Als er vragen in staan: de bot verwerkt ze in de SQLite database en zet het bestand daarna weer terug naar `[]`.
	- Als er niks in staat: er gebeurt niks.

### Formaat

Gebruik een JSON array. Dit legacy-format werkt:

```json
[
	{
		"vraag": "Wat is 2 + 2?",
		"opties": { "A": "3", "B": "4", "C": "5", "D": "22" },
		"antwoord": "B"
	}
]
```

Na het starten van de bot worden de vragen geïmporteerd en wordt `quiz-import.json` automatisch geleegd.
