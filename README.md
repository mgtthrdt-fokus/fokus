# Fokus

Persönliches Gliederungs-, Aufgaben- und Meeting-Werkzeug (PWA). Enthält keine Daten: diese liegen in einem separaten privaten Repo und werden per GitHub-API synchronisiert. Der Zugriffstoken liegt nur verschlüsselt in `public/vault.json` (AES-GCM, Schlüssel aus PBKDF2-SHA256 der Passphrase, 600 000 Iterationen) und wird auf dem Gerät mit der Passphrase entsperrt.

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # Merge, Migration, Rollups, Tresor
npm run build      # dist/, wird per GitHub Action auf Pages veröffentlicht
npm run vault      # Token + Passphrase → public/vault.json (versteckte Eingabe)
```

Tastatur: `Enter` neue Zeile · `Tab`/`Shift+Tab` ein-/ausrücken · `Alt+↑/↓` verschieben · `Strg+Enter` erledigt · `Strg+.` hineinzoomen · `Esc` eine Ebene hoch · `Alt+1…4` Detailtiefe · `F` Fokusmodus · `Strg+/` oder Rechtsklick: Typ, Status, Pausieren, Löschen.
