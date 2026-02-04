Ik wil een casino functie toevoegen, dit zijn mijn ideen. 


1. De Economie (De Regels)
    Doel: Een Haribo zakje kost 5.000 punten.
    Inkomen (Quiz): 150 punten per goed antwoord met de dagelijkse quiz.
    Risico (Casino): Inzet staat vast op 400 punten per weddenschap.
    Reset: Elke 1e van de maand reset iedereen naar 0, De top 3 krijgt in de nieuwe maand startpunten.
        Startbonus: #1 (2.000), #2 (1.000), #3 (500).

2. Hoe het Casino werkt (Automatische Balans)

    Jij hoeft geen odds te berekenen. De klas bepaalt de odds zelf.
    De Pot: Alle inzet (400 p.p.) gaat op één hoop.
    Belasting: De bot verbrandt direct 10% van de pot (anti-inflatie).
    Verdeling: De overgebleven pot wordt verdeeld over de winnaars.
    Veiligheid: Maximale uitbetaling is 3x je inzet (1.200 punten). Als de pot groter is, verdwijnt het overschot.

Dit casino-systeem werkt als een "Prediction Market", vergelijkbaar met echte wedplatforms zoals Kalshi, waar de winstkansen (odds) organisch worden bepaald door wat de groep stemt. In plaats van tegen een vaste computer te spelen, wedden klasgenoten tegen elkaar: de inzet van de verliezers vormt de pot die wordt verdeeld onder de winnaars. Hoe minder mensen op de juiste uitslag durven te gokken, hoe groter de individuele uitbetaling voor die "underdogs" wordt. Om te voorkomen dat één gelukkige gok de hele maandbalans verpest, is de winst begrensd op drie keer je inzet, terwijl een belasting van 10% inflatie tegengaat. Het lijkt hiermee op een interactief spel waarbij je kennis van je klasgenoten en docenten direct wordt omgezet in punten voor je volgende zakje Haribo.

Voor de casino vragen: alleen Boolean True/False



    /bet status

        Laat de actieve weddenschap zien en de huidige verdeling. in een embed met de stemming etc. Laat ook de namen zijn links rechts voor de waardes

        Voorbeeld output: "Vraag: Komt de docent te laat? | JA: 6 stemmen | NEE: 2 stemmen | Potentiële winst bij NEE: 2.8x".

    /bet [keuze]

        Zet 400 punten in op "JA" of "NEE".

        Check: Heb je < 400 punten? Dan weigert de bot.

    /shop (haribo)
        /shop laat zien wat je kan kopen
        /shop buy haribo laat je haribo kopen
        Koopt een zakje als je > 5.000 punten hebt.
        Stuurt een ping naar jou (Admin) en verlaagt de voorraad.
        Let op, maximaal 4 zakjes per maand beschikbaar, daarna kan je niet meer kopen

    /saldo 
        Toont huidige punten en positie in de maand.

Voor Jou (Admin)

    /admin bet create [vraag]

        Start een nieuwe gokronde.

        Voorbeeld: /admin bet create "Haalt meer dan 50% een voldoende voor Recht?"
        Let op, Elke vraag eindigt op de laatste dag van de maand, Een bet is dus maar een maand geldig en daarna vervalt deze. 

    /admin bet resolve Ja/Nee

        Sluit de weddenschap en keert uit.
        Voorbeeld: /admin bet resolve JA



4. Rekenvoorbeeld (Hoe het in de praktijk gaat)

Stel, je maakt de vraag: "Komt Sam vandaag te laat?"
Er doen 8 mensen mee (Inzet 400).

    Totale Pot: 8×400=3.200 punten.

    Na Belasting (10%): 2.880 punten om te verdelen.

Scenario A: De Veilige Gok (Favoriet wint)

    6 mensen stemmen "NEE" (Sam komt op tijd).

    Uitslag: NEE wint.

    Rekensom: 2.880/6=480 punten per persoon.

    Winst: Je krijgt je inzet (400) terug + 80 punten winst.

        Effect: Nauwelijks winst, maar je verliest niks.

Scenario B: De Klapper (Underdog wint)

    2 mensen stemmen "JA" (Sam komt te laat).

    Uitslag: JA wint.

    Rekensom: 2.880/2=1.440 punten.

    De Cap: Max uitbetaling is 1.200.

    Uitbetaling: De winnaars krijgen 1.200 punten (400 inzet + 800 winst). De rest vloeit terug naar de bot.

        Effect: Grote stap richting de Haribo.

5. Samenvatting voor de Developer (Jij)

Als je dit gaat bouwen, is dit je checklist voor de database/logica:

    Database Tabel users: id, balance, monthly_wins, last_quiz_date.

    Database Tabel bets: id, question, status (open/closed), total_pool.

    Database Tabel bet_entries: bet_id, user_id, choice (JA/NEE).

    Logica bij /bet resolve:

        Tel stemmen voor winnende kant.

        Payout = (Pool * 0.9) / Aantal_Winnaars.

        If Payout > 1200: Payout = 1200.

        Update user balances.

Volgende stap:
Zal ik de code voor het /admin bet resolve commando voor je uitschrijven? Dat is wiskundig het lastigste stukje code.


Channels: 
 - 1468608557279612998 voor de casino vragen (bij aanmaken hier laten zien. Update de embed bij idere update dat iemand stemd met de commando, laat udidelijk zien wat de balans is etc etc) Stuur hier ook de resultaten in. 


 