# Malteser Sammlung App – Setup-Anleitung

## Was du brauchst
- Ein kostenloses Google-Konto
- Ca. 15 Minuten

---

## Schritt 1: Firebase-Projekt erstellen

1. Gehe zu **https://console.firebase.google.com**
2. Klicke auf **„Projekt hinzufügen"**
3. Projektnamen eingeben (z.B. `malteser-sammlung`)
4. Google Analytics: kann deaktiviert werden → **Projekt erstellen**

### Anonymous Authentication aktivieren
5. Im linken Menü: **Authentication → Erste Schritte**
6. Tab **„Sign-in method"** → **Anonym** → Aktivieren → Speichern

### Realtime Database anlegen
7. Im linken Menü: **Realtime Database → Datenbank erstellen**
8. Standort: **Europe (europe-west1)**
9. Sicherheitsregeln: **„Im Testmodus starten"** (ausreichend für interne Nutzung)
10. Nach der Erstellung: Tab **„Regeln"** → folgenden Text einfügen und **Veröffentlichen**:

```json
{
  "rules": {
    "events":    { ".read": true, ".write": "auth != null" },
    "teams":     { ".read": true, ".write": "auth != null" },
    "locations": { ".read": true, ".write": "auth != null" },
    "visited":   { ".read": true, ".write": "auth != null" },
    "users":     { ".read": true, ".write": "auth != null" }
  }
}
```

### Firebase-Konfiguration kopieren
11. **Projekteinstellungen** (Zahnrad-Symbol) → Tab **„Allgemein"**
12. Runterscrollen zu **„Deine Apps"** → **Web-App hinzufügen** (</> Symbol)
13. App-Spitznamen eingeben → **Registrieren**
14. Den `firebaseConfig`-Block kopieren

---

## Schritt 2: Google Maps API Key erstellen

1. Gehe zu **https://console.cloud.google.com**
2. Wähle dasselbe Google-Konto → Projekt auswählen oder neu erstellen
3. Suche nach **„Maps JavaScript API"** → aktivieren
4. Suche nach **„Places API"** → aktivieren
5. Gehe zu **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → API-Schlüssel**
6. Den API-Schlüssel kopieren

> **Tipp:** Den Key auf deine Domain beschränken (Schlüssel bearbeiten → Anwendungsbeschränkungen → HTTP-Referrer)

---

## Schritt 3: App konfigurieren

Öffne die Datei **`firebase-config.js`** und ersetze alle Platzhalter:

```js
const firebaseConfig = {
  apiKey:            "AIza...",          // ← aus Schritt 1
  authDomain:        "mein-projekt.firebaseapp.com",
  databaseURL:       "https://mein-projekt-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "mein-projekt",
  storageBucket:     "mein-projekt.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc..."
};

window.GOOGLE_MAPS_KEY = "AIza...";     // ← aus Schritt 2
```

---

## Schritt 4: App online stellen (Hosting)

### Option A: Firebase Hosting (empfohlen, kostenlos)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting     # Wähle dein Projekt, public folder = . (Punkt)
firebase deploy
```
→ Du erhältst eine URL wie `https://mein-projekt.web.app`

### Option B: GitHub Pages
1. GitHub-Konto erstellen → neues Repository erstellen
2. Alle App-Dateien hochladen
3. Repository-Einstellungen → Pages → Branch: main → Ordner: / (root)
→ URL: `https://deinname.github.io/repo-name`

### Option C: Netlify (am einfachsten)
1. Gehe zu **https://netlify.com** → kostenlos registrieren
2. „Sites" → **„Add new site → Deploy manually"**
3. Den `malteser-app` Ordner per Drag & Drop hochladen
→ Du erhältst sofort eine URL

---

## Schritt 5: Als App installieren (PWA)

### Android (Chrome)
- URL öffnen → Menü (⋮) → **„App installieren"** oder **„Zum Startbildschirm"**

### iPhone/iPad (Safari)
- URL öffnen → Teilen-Symbol (☐↑) → **„Zum Home-Bildschirm"**

### Desktop (Chrome/Edge)
- In der Adressleiste erscheint ein Installations-Symbol (📥)

---

## Bedienung

### TeamCoach (TC)
1. App öffnen → **TeamCoach** wählen → Namen eingeben → **„Neues Event erstellen"**
2. Der **6-stellige Code** erscheint oben rechts – diesen an alle Sammler schicken
3. **„⚙ Teams"** → Teams anlegen, Sammler per Dropdown zuweisen
4. **„✏ Gebiet"** → Auf der Karte Polygon einzeichnen → Team auswählen
5. Alle Standorte der Sammler sichtbar (live, alle 30 Sek. aktualisiert)

### Sammler
1. App öffnen → **Sammler** wählen → Namen + Code eingeben → **„Beitreten"**
2. Eigenes hervorgehobenes Gebiet auf der Karte sichtbar
3. **„🏠 Haus"** → auf Haus tippen → optional Straße/Nr. eingeben → Bestätigen
4. **„📍 Abholort"** → aktuellen Standort teilen (WhatsApp, SMS, etc.)
5. **„⏸ Pause"** → Standort wird für andere ausgeblendet (z.B. Mittagspause)
6. **„🎯 Standort"** → Karte auf eigene Position zentrieren

---

## Technische Details

| Funktion | Technik |
|---|---|
| Standort-Update | alle 30 Sekunden (akku-schonend) |
| Datenübertragung | nur Koordinaten (≈ 50 Byte/Update) |
| Offline-Fähigkeit | Karte und App-Shell gecacht |
| Authentifizierung | Firebase Anonymous Auth (kein Passwort) |
| Datenspeicherung | Firebase Realtime DB (EU-Region) |
| Plattform | PWA – läuft auf iOS, Android, Desktop |

---

## Datenschutz-Hinweis
Die Standortdaten werden nur während der aktiven Sammlung in Firebase gespeichert.
Nach dem Schließen der App wird der eigene Standort automatisch als „pausiert" markiert.
Für eine DSGVO-konforme Nutzung empfehlen wir, alte Events nach der Sammlung in der
Firebase Console zu löschen.
