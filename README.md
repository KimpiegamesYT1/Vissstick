# Vissstick Discord Bot 🐔

Discord bot voor het weergeven van het HOK van Syntaxis.

## Features

- **Hok Monitoring** - Realtime status of het hok open/dicht is met tijdsschatting
- **Publieke Hok API** - Read-only endpoint voor apps/website (`/api/public/hok/status`)
- **Dagelijkse Quiz** - Elke dag om 7:00 een nieuwe vraag, antwoord om 17:00 (150 punten per goed antwoord)
- **Dagelijkse Rekensom** - Elke dag 1x willekeurig tussen 07:00 en 16:00, eerste juiste chatantwoord wint 200 punten
- **Casino Systeem** - Wedden op JA/NEE vragen, verdien punten
- **Shop** - Koop Haribo zakjes met 5.000 punten
- **Maandelijks Scoreboard** - Laatste dag om 18:00 resultaten + directe maandreset met top 3 startbonus (2000/1000/500 punten)
- **Audio Player** - Speel MP3 bestanden af in voice channels
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

### Publieke Hok API

De bot kan een publieke read-only API starten in dezelfde process.

- Endpoint: `GET /api/public/hok/status`
- Doel: status open/dicht + voorspelde open/sluit tijd (geen gevoelige data)
- Security: rate limiting, cache, method guard (`GET`/`OPTIONS`), security headers

Config keys:

- `PUBLIC_API_ENABLED` - `true`/`false` (default: `true`)
- `PUBLIC_API_PORT` - poort voor de API server (default: `3000`)
- `PUBLIC_API_CACHE_SECONDS` - response cache TTL (default: `30`)
- `PUBLIC_API_RATE_LIMIT_WINDOW_MS` - rate-limit window in ms (default: `60000`)
- `PUBLIC_API_RATE_LIMIT_MAX_REQUESTS` - max requests per IP per window (default: `60`)
- `PUBLIC_API_CORS_ORIGIN` - `*` of CSV-lijst met toegestane origins

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

## Audio bestanden toevoegen

De bot kan .MP3 bestanden afspelen in voice channels.

- Plaats `.mp3` bestanden in de `audio/` folder
- De bot detecteert automatisch nieuwe bestanden
- `/audio` voor een lijst van beschikbare audio
- `/audioplay <bestand>` om een bestand af te spelen in je huidige voice channel
- `/audiosend <bestand>` om een bestand te sturen in je huidige channel
- `/audiostop` om het afspelen te stoppen

De bot joint automatisch je voice channel en verlaat deze na het afspelen.
