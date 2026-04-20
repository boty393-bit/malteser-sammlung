/* =========================================
   FIREBASE + GOOGLE MAPS KONFIGURATION
   ─────────────────────────────────────────
   1. Gehe zu https://console.firebase.google.com
   2. Neues Projekt erstellen (kostenlos)
   3. Projekt-Einstellungen → Deine Apps → Web-App hinzufügen
   4. Die Werte unten ersetzen
   5. In Firebase Console: Authentication → Sign-in method → Anonymous aktivieren
   6. In Firebase Console: Realtime Database → Erstellen (Testmodus reicht)
   7. Google Maps API Key bei https://console.cloud.google.com erstellen
      (Maps JavaScript API + Places API aktivieren)
   ========================================= */

// ─── Firebase ────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "DEIN_FIREBASE_API_KEY",
  authDomain:        "DEIN_PROJEKT_ID.firebaseapp.com",
  databaseURL:       "https://DEIN_PROJEKT_ID-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "DEIN_PROJEKT_ID",
  storageBucket:     "DEIN_PROJEKT_ID.appspot.com",
  messagingSenderId: "DEINE_SENDER_ID",
  appId:             "DEINE_APP_ID"
};

firebase.initializeApp(firebaseConfig);

// ─── Google Maps API Key ──────────────────────────────────────────────────────
// Dieser Key wird in index.html beim Laden der Google Maps Bibliothek verwendet.
window.GOOGLE_MAPS_KEY = "DEIN_GOOGLE_MAPS_API_KEY";

/* ─────────────────────────────────────────
   Firebase Realtime Database Regeln
   (in der Firebase Console einstellen)
   ─────────────────────────────────────────
   {
     "rules": {
       "events": {
         ".read": true,
         ".write": "auth != null"
       },
       "teams": {
         ".read": true,
         ".write": "auth != null"
       },
       "locations": {
         ".read": true,
         ".write": "auth != null"
       },
       "visited": {
         ".read": true,
         ".write": "auth != null"
       },
       "users": {
         ".read": true,
         ".write": "auth != null"
       }
     }
   }
   ───────────────────────────────────────── */
