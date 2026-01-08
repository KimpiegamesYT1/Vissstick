# 📊 Hok Dashboard

Web-gebaseerd dashboard voor het monitoren en configureren van Hok status voorspellingen. Dit dashboard maakt het mogelijk om alle parameters die gebruikt worden voor voorspellingen live aan te passen en de resultaten direct te visualiseren.

## ✨ Features

### 📈 Visualisatie
- **Weekoverzicht**: Zie open en sluit tijden per weekdag met voorspellingen
- **Dagelijkse tijdlijn**: Volledige historische data in een scatter plot
- **Voorspellingen**: Per weekdag de voorspelde open/sluit tijden met gewogen mediaan

### ⚙️ Parameter Configuratie
Alle parameters zijn live aanpasbaar via de web interface:

#### Check Intervallen
- **Check Interval (Open)**: Hoe vaak de API gecontroleerd wordt als hok open is (ms)
- **Check Interval (Dicht)**: Hoe vaak de API gecontroleerd wordt als hok dicht is (ms)
- **Check Interval (Nacht)**: Hoe vaak de API gecontroleerd wordt tussen 22:00-05:00 (ms)

#### Nacht Periode
- **Nacht Start Uur**: Begin van de nachtperiode (0-23)
- **Nacht Eind Uur**: Einde van de nachtperiode (0-23)

#### Data & Filtering
- **Geschiedenis Limiet**: Hoeveel dagen terug voor analyses (dagen)
- **Minimum Sessie Duur**: Minimum duur voor geldige sessie (minuten)
- **Voorspelling Lookback**: Hoeveel maanden terug voor voorspellingen (maanden)

#### Gewichten (Weighted Median)
- **Gewicht Huidige Maand**: Gewicht voor data van huidige maand (0.0 - 2.0)
- **Gewicht 1 Maand Geleden**: Gewicht voor data van 1 maand geleden (0.0 - 2.0)
- **Gewicht 2 Maanden Geleden**: Gewicht voor data van 2 maanden geleden (0.0 - 2.0)
- **Gewicht 3+ Maanden Geleden**: Gewicht voor data van 3+ maanden geleden (0.0 - 2.0)

### 📋 Data Management
- Bekijk alle hok status logs in een overzichtelijke tabel
- Filter op periode (aantal dagen)
- Zie alle events met datum, tijd, type (open/dicht) en weekdag

### 📊 Statistieken
- Totaal aantal logs
- Eerste en laatste log datum
- Huidige status

## 🚀 Installatie & Gebruik

### Vereisten
- Node.js (v14 of hoger)
- NPM of Yarn
- De Vissstick bot database (bot.db)

### Installatie

```bash
cd hok-dashboard
npm install
```

### Starten

```bash
npm start
```

Of voor development met auto-reload:

```bash
npm run dev
```

De dashboard is beschikbaar op: **http://localhost:3000**

## 📁 Project Structuur

```
hok-dashboard/
├── server.js              # Express backend server met API endpoints
├── package.json           # Dependencies en scripts
├── public/               
│   ├── index.html        # Hoofdpagina met tabs en UI
│   ├── style.css         # Styling (gradient design, responsive)
│   └── app.js            # Frontend JavaScript met Chart.js
└── README.md             # Deze file
```

## 🔌 API Endpoints

### Parameters
- `GET /api/parameters` - Haal huidige parameters op
- `PUT /api/parameters` - Update parameters

### Logs
- `GET /api/logs?days=30` - Haal alle logs op (met optionele periode)
- `GET /api/logs/filtered?days=30&minDuration=30` - Haal gefilterde logs op (alleen geldige sessies)
- `POST /api/logs` - Voeg nieuwe log toe
- `DELETE /api/logs/:id` - Verwijder log

### Voorspellingen
- `GET /api/predictions` - Bereken voorspellingen per weekdag met huidige parameters

### Statistieken
- `GET /api/stats` - Haal algemene statistieken op

## 🎨 Technologieën

- **Backend**: Express.js + better-sqlite3
- **Frontend**: Vanilla JavaScript + Chart.js
- **Styling**: Custom CSS met gradient design
- **Database**: SQLite (gebruikt dezelfde bot.db als de Discord bot)

## 📝 Gebruik Tips

1. **Parameters aanpassen**: Ga naar de "Parameters" tab en pas waarden aan. Klik op "Opslaan" om wijzigingen toe te passen.

2. **Voorspellingen bekijken**: De "Visualisatie" tab toont direct de impact van parameter wijzigingen op voorspellingen.

3. **Gewichten fine-tunen**: 
   - Verhoog gewicht van huidige maand voor recenter gedrag
   - Verlaag gewicht van oudere maanden als patronen zijn veranderd
   - Gebruik gelijke gewichten voor consistente patronen

4. **Minimum sessie duur**: 
   - Verhoog om korte "blips" te negeren
   - Verlaag om meer datapunten mee te nemen

5. **Lookback periode**:
   - Langer = meer data, maar minder responsief op veranderingen
   - Korter = responsiever, maar minder stabiel bij weinig data

## 🔧 Troubleshooting

### Dashboard start niet
- Controleer of poort 3000 vrij is
- Controleer of bot.db bestaat in de parent directory

### Geen data zichtbaar
- Controleer of bot.db logs bevat (`SELECT COUNT(*) FROM hok_status_log`)
- Verhoog de periode (aantal dagen) in de visualisatie

### Parameters worden niet opgeslagen
- Check console voor errors
- Controleer of de hok_parameters tabel bestaat

## 📄 Licentie

MIT

## 👤 Auteur

Vissstick Discord Bot Team
