Doel: Bouw een "Double or Nothing" gok-commando voor een Discord bot in Python (discord.py).
1. Mechaniek & Balans

    Input: Gebruiker kiest een inzet van 25 of 50 punten. (2 groene knoppen)
    Winstkans: 49% per ronde (1% huisvoordeel om inflatie te voorkomen).

    Flow:
        Ronde 1: De inzet wordt van het saldo afgetrokken. Bij winst verdubbelt de pot.
        Keuzemoment: Na elke winst krijgt de speler twee moderne Discord knoppen: Stoppen (uitbetalen) of Verdubbelen (volgende ronde).
        Verlies: De hele pot is weg en de interactie stopt.

    Limiet: Maximaal 5 keer achter elkaar winnen. Bij de 5e winst keert de bot automatisch uit om misbruik te voorkomen (Max winst is 1.600 punten bij een startinzet van 50).

2. UI/UX Design (Discord Embeds & Buttons)

    Embed Stijl: Minimalistisch en clean. 
    Geen Emoji's: Teksten op knoppen moeten puur tekst zijn (geen icoontjes).

    Indeling:
        Titel: "Double or Nothing"
        Status: Geef in de tekst aan in welke ronde de speler zit (bijv. "Ronde 3 van 5").
        Bedragen: Toon duidelijk de "Huidige Pot" en de "Potentiële Winst" bij de volgende ronde.

    Knoppen:

        ButtonStyle.primary (Blurple) voor de knop: Verdubbelen
        ButtonStyle.secondary (Grijs) voor de knop: Stoppen en Uitbetalen

3. Logica voor de Code

    Gebruik een discord.ui.View om de knoppen en hun "callbacks" af te handelen.

    Zorg voor foutafhandeling: Alleen de persoon die het commando startte mag op de knoppen klikken.

    Database-integratie: Schrijf code die na elke ronde het saldo in de SQLite-database pas definitief bijwerkt wanneer de speler stopt of verliest, om "spammen" te voorkomen.

    Let op, Stel ik begin met 50, dan moet hij niet instant zeggen wat de winst is een soort animatie spelen of even 3s wachten voordat je stuurt. Let op pas steeds de embed aan, stuur niet nieuwe berichten voor iedere update