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
