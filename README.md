# Fokus

Persönliches Gliederungs-, Aufgaben- und Meeting-Werkzeug (PWA). Enthält keine Daten: diese liegen in einem separaten privaten Repo und werden per GitHub-API synchronisiert. Der Zugriffstoken liegt nur verschlüsselt in `public/vault.json` (AES-GCM, Schlüssel aus PBKDF2-SHA256 der Passphrase, 600 000 Iterationen) und wird auf dem Gerät mit der Passphrase entsperrt.

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # Merge, Migration, Rollups, Tresor
npm run build      # dist/, wird per GitHub Action auf Pages veröffentlicht
npm run vault      # Token + Passphrase → public/vault.json (versteckte Eingabe)
```

Tastatur (`?` in der App zeigt alle): `N` neu · `Strg+K` suchen · `Strg+Z` rückgängig · `Enter`/`Tab` Gliederung · `Strg+Enter` erledigt · `Esc` hoch · `Alt+1…4` Detailtiefe · `F` Fokusmodus · `⋯`/Rechtsklick Aktionen.

Funktionen: Gliederung mit Zoom und Drag & Drop, Heute (Liste oder Tagesplan mit Zeitblöcken), Board, Meetings, Wochenrückblick, wiederkehrende Aufgaben (`jeden mo`, `werktags`), Fokus-Timer 25/5 mit Ist-Zeit, Rückgängig, Obsidian-Links (`obsidian://`).
