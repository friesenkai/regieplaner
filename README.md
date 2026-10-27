# regieplaner
(Achtung: vollständig vibecoded mit GitHub Codespaces!)

Visualisierung eines Regieablaufes.

Im Bearbeitungsmodus können neue Ablaufpunkte hinzugefügt werden, die im Live-Modus manuell der zeitgesteuert voranschreiten.

Regiepläne können als JSON-Datei oder über den Link eines öffentlichen GitHub-Gists importiert werden. Der Gist muss genau eine JSON-Datei im Regieplan-Exportformat enthalten.

Der Werbetimer oben rechts lässt sich im Bearbeitungsmodus als Minuten:Sekunden-Standarddauer einstellen. Für einzelne Karten mit „Werbung“ im Titel kann zusätzlich eine eigene Dauer festgelegt werden; bleibt das Feld leer, gilt die Standarddauer. Im Live-Modus startet der Timer für die aktive Karte mit "Werbung" im Namen und markiert sie nach Ablauf automatisch als erledigt.

vmix_fn01: über einen im Hintergrund aberufenen Link können vMix-Funktionen gestartet werden

vmix_fn02: (in progress) über einen im Hintergrund aberufenen Link können Abläufe des Bitfocus Companion gestartet werden

## Lizenz

Dieses Projekt steht unter der MIT-Lizenz. Siehe [LICENSE](./LICENSE).