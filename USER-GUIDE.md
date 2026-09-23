# Benutzer-Handbuch — Bundesanzeiger Jahresabschluss

> **Zweck**: Schritt-für-Schritt-Anleitung für Steuerberater und Wirtschaftsprüfer
> zur Erfassung von Jahresabschlüssen und deren Veröffentlichung im Bundesanzeiger.
>
> **Version**: M1 (Pilot)
> **Datum**: 2026-09-23
> **Sprache**: Deutsch

---

## 1. Erste Schritte

### 1.1 Anmeldung

1. Browser öffnen → `https://pilot.banz-jahresabschluss.example`
2. E-Mail-Adresse eingeben (z. B. `steuerberater@kanzlei.de`)
3. Passwort eingeben (Initial-Passwort vom Kanzlei-Administrator)
4. **TOTP-Code** (falls Sie Zwei-Faktor-Authentifizierung aktiviert haben):
   - Google Authenticator / 1Password / Authy öffnen
   - 6-stelligen Code für "Bundesanzeiger Jahresabschluss" eingeben
5. **Anmelden** klicken

**Bei Problemen**: Wenden Sie sich an Ihren Kanzlei-Administrator.

### 1.2 Mandanten wechseln

Nach der Anmeldung sehen Sie oben links einen **Mandanten-Switcher**:

```
Mandant: [Demo GmbH (KLEINST)] ▼
```

Klicken Sie auf den Dropdown-Pfeil, um zwischen Ihren zugänglichen Mandanten zu wechseln. Alle nachfolgenden Aktionen beziehen sich auf den aktiven Mandanten.

---

## 2. Jahresabschluss erfassen

### 2.1 Bilanz erfassen

**Navigation**: Bilanz → **Neue Bilanz erstellen**

1. **Geschäftsjahr** auswählen (z. B. 2025)
2. **Aktiva** befüllen (linke Spalte):
   - Anlagevermögen (Sachanlagen, Finanzanlagen, Immaterielle)
   - Umlaufvermögen (Forderungen, Bankguthaben, Vorräte)
   - Rechnungsabgrenzungsposten
3. **Passiva** befüllen (rechte Spalte):
   - Eigenkapital (Gezeichnetes Kapital, Gewinnrücklagen)
   - Rückstellungen
   - Verbindlichkeiten
4. **Live-Saldo prüfen**: Am oberen Rand des Formulars sehen Sie:
   ```
   Aktiva: 250.000,00 € · Passiva: 250.000,00 € · Differenz: 0,00 €
   ```
   → **Grün** = Saldo stimmt
   → **Gelb** = Saldo weicht ab (Differenz anzeigen)
5. **Speichern** klicken

**Validierung**: Nach dem Speichern können Sie mit **Saldo prüfen** die formale Korrektheit prüfen (Aktiva == Passiva).

### 2.2 GuV erfassen

**Navigation**: GuV → **Neue GuV erstellen**

1. **Verfahren** wählen:
   - **Gesamtkostenverfahren (GKV)** — Standard für GmbH nach § 275 Abs. 2 HGB
   - **Umsatzkostenverfahren (UKV)** — bei Bedarf § 275 Abs. 1 HGB
2. **Positionen** befüllen:
   - Erlöse (Umsatzerlöse, sonstige betriebliche Erträge)
   - Aufwendungen (Material, Personal, Abschreibungen, sonstige)
3. **Live-Ergebnis** prüfen (Jahresüberschuss / Jahresfehlbetrag)
4. **Speichern**

### 2.3 Anhang erstellen

**Navigation**: Anhang → **Neuen Anhang erstellen**

Standardabschnitte (gem. § 284 HGB) sind vorausgefüllt:

1. **Allgemeine Angaben** (Firma, Sitz, Handelsregister)
2. **Bilanzierungs- und Bewertungsmethoden** (§ 252 HGB)
3. **Erläuterungen zur Bilanz** (einzelne Positionen)
4. **Erläuterungen zur GuV** (einzelne Positionen)
5. **Sonstige Pflichtangaben** (Geschäftsführerbezüge, Haftungsverhältnisse)

Bei Bedarf: **+ Abschnitt hinzufügen** für individuelle Abschnitte.

---

## 3. PDF erzeugen und archivieren

### 3.1 PDF generieren

In der **Bilanz-Liste** (oder GuV/Anhang-Liste) finden Sie eine **PDF**-Spalte:

1. Klicken Sie auf **PDF erzeugen**
2. Warten Sie, bis die Erfolgsmeldung erscheint
3. Das PDF wird automatisch im WORM-Storage abgelegt (10 Jahre, § 147 AO)

**Hinweis-Badge**: Nach erfolgreicher Erzeugung erscheint:
```
WORM-archiviert (10 Jahre, § 147 AO)
```

### 3.2 PDF anzeigen / herunterladen

Sobald das PDF erzeugt wurde, stehen Ihnen zwei Aktionen zur Verfügung:

- **PDF anzeigen**: Öffnet das PDF im neuen Browser-Tab (browser-interner Viewer)
- **PDF herunterladen**: Speichert das PDF lokal

### 3.3 Kombinierter Jahresabschluss

**Navigation**: Jahresabschluss → **Jahresabschluss-PDF erzeugen**

Erzeugt ein **kombiniertes PDF** mit allen drei Bestandteilen:
- Bilanz (mit HGB-Schema)
- GuV (mit GKV/UKV)
- Anhang (mit allen Abschnitten)

---

## 4. Audit-Log einsehen

**Navigation**: Audit-Log

Alle Aktionen werden revisionssicher protokolliert (§ 147 AO):

### 4.1 Filter

Sie können nach folgenden Kriterien filtern:
- **Aktion**: PDF generiert, Erstellt, Geändert, Anmeldung, etc.
- **Entitätstyp**: Mandant, Bilanz, GuV, Anhang, User
- **Zeitraum**: Von-Datum / Bis-Datum

### 4.2 Spalten

- **Zeitstempel**: Datum + Uhrzeit der Aktion
- **Benutzer**: User-ID (anonymisiert in Pilot-Phase)
- **Aktion**: Art der Aktion (farbcodiert)
- **Entität**: Entitätstyp + Entitäts-ID
- **Mandant**: Mandanten-ID (zur Mandant-Isolation)

### 4.3 Typische Anwendungsfälle

- **"Wer hat Bilanz X zuletzt geändert?"** → Filter: Entitätstyp = Bilanz, sortiere nach Zeitstempel
- **"Welche PDFs wurden diesen Monat erzeugt?"** → Filter: Aktion = PDF generiert, Zeitraum = letzter Monat
- **"Gibt es fehlgeschlagene Logins?"** → Filter: Aktion = Anmeldung, sortiere nach Zeitstempel (admin only)

---

## 5. Mandant-Verwaltung (für Kanzlei-Admins)

### 5.1 Neuen Mandanten anlegen

**Navigation**: Mandanten → **Neuen Mandanten anlegen**

Pflichtfelder:
- **Firmenname** (z. B. "Mustermann GmbH")
- **Rechtsform** (GmbH, GmbH & Co. KG, AG)
- **Adresse** (Straße, PLZ, Ort, Land)
- **Geschäftsführer** (Name, Geburtsdatum, Anteil in %)
- **Handelsregister-Nr.** (z. B. HRB 123456)

Optional:
- **Gründungsdatum**
- **Bilanzsumme Vorjahr** (€) — für Größenklassen-Berechnung
- **Umsatz Vorjahr** (€)
- **Mitarbeiteranzahl**
- **Veröffentlichungskanal** (PDF_DIRECT, XML_XBRL, EBILANZ_TAXONOMIE)

### 5.2 Größenklasse

Wird automatisch berechnet:
- **Kleinst** ≤ 350k € Bilanzsumme und ≤ 700k € Umsatz und ≤ 10 MA
- **Klein** ≤ 6 Mio € Bilanzsumme und ≤ 12 Mio € Umsatz und ≤ 50 MA
- **Mittel** ≤ 20 Mio € Bilanzsumme und ≤ 40 Mio € Umsatz und ≤ 250 MA
- **Groß** > Mittel

---

## 6. Benutzer-Verwaltung (für Kanzlei-Admins)

### 6.1 Neuen Benutzer anlegen

**Navigation**: Benutzer → **Neuen Benutzer anlegen**

1. **E-Mail-Adresse** eingeben
2. **Vorname + Nachname** eingeben
3. **Rolle** wählen: GF / STEUERBERATER / WIRTSCHAFTSPRUEFER / KANZLEI_ADMIN
4. **Mandanten zuweisen** (mind. 1)
5. **Speichern** → E-Mail-Invite wird versendet

### 6.2 TOTP-Aktivierung (2FA)

Bei erster Anmeldung:
1. Login mit Initial-Passwort
2. System fordert TOTP-Setup
3. QR-Code mit Authenticator-App scannen (Google Authenticator, 1Password, etc.)
4. 6-stelligen Bestätigungscode eingeben
5. **Wiederherstellungscodes** speichern (einmalig sichtbar)

**Wichtig**: Wiederherstellungscodes an einem sicheren Ort aufbewahren! Bei Verlust des TOTP-Geräts kann der Kanzlei-Admin das TOTP zurücksetzen.

---

## 7. Häufige Fragen (FAQ)

### 7.1 "Saldo stimmt nicht" — was tun?

**Mögliche Ursachen**:
- Positionen in Aktiva/Passiva unterschiedlich
- Rundungsdifferenzen
- Jahresüberschuss/-fehlbetrag nicht eingetragen

**Lösung**:
1. Prüfen Sie, ob alle HGB-Positionen befüllt sind
2. Suchen Sie nach der größten Differenz in den Beträgen
3. Konsultieren Sie ggf. Ihren Steuerberater

### 7.2 "PDF kann nicht erzeugt werden"

**Mögliche Ursachen**:
- WORM-Storage nicht erreichbar (Backend-Log prüfen)
- Bilanz/GuV/Anhang nicht saldostimmend

**Lösung**: Versuchen Sie es nach 1-2 Minuten erneut. Bei wiederholtem Fehler: Kanzlei-Admin kontaktieren.

### 7.3 "Zugriff verweigert"

**Ursache**: Sie haben keine Berechtigung für diesen Mandanten oder diese Aktion.

**Lösung**: Wenden Sie sich an Ihren Kanzlei-Administrator.

### 7.4 "Kann mich nicht anmelden"

**Mögliche Ursachen**:
- Falsches Passwort
- TOTP-Code falsch oder abgelaufen (30 Sekunden Zeitfenster)
- Konto gesperrt

**Lösung**:
1. Passwort erneut eingeben (Caps-Lock prüfen)
2. TOTP-Code erneut aus Authenticator ablesen
3. Nach 5 Fehlversuchen: Kanzlei-Admin kontaktieren

### 7.6 "Was passiert nach 10 Jahren mit den PDFs?"

Die im WORM-Storage abgelegten PDFs sind **unveränderlich** für 10 Jahre.
Nach Ablauf der Retention werden sie automatisch in den **Glacier-Tier** verschoben (geplant für M4).
Sie können jederzeit ein PDF exportieren, falls Sie es an einen anderen Speicherort übertragen möchten.

---

## 8. Glossar

| Begriff | Bedeutung |
|---|---|
| **Mandant** | Eine GmbH / GmbH & Co. KG / AG, für die ein Jahresabschluss erstellt wird |
| **Kanzlei** | Steuerberater-Praxis, die mehrere Mandanten betreut |
| **Bilanz** | Gegenüberstellung von Vermögen (Aktiva) und Kapital (Passiva) zum Stichtag |
| **GuV** | Gewinn- und Verlustrechnung — Aufstellung der Erträge und Aufwendungen |
| **Anhang** | Ergänzende Erläuterungen zu Bilanz und GuV (Pflicht nach § 284 HGB) |
| **GKV / UKV** | Gesamtkostenverfahren / Umsatzkostenverfahren (zwei Varianten der GuV) |
| **WORM** | Write Once, Read Many — Unveränderlicher Speicher (10 Jahre Retention) |
| **Audit-Trail** | Revisionssichere Protokollierung aller Mutationen (§ 147 AO) |
| **RBAC** | Role-Based Access Control — Rollenbasierte Zugriffskontrolle |
| **TOTP** | Time-based One-Time Password — 2-Faktor-Authentifizierung |
| **BAnz** | Bundesanzeiger — Pflicht-Veröffentlichungsplattform für Kapitalgesellschaften |

---

## 9. Support

**Bei Fragen oder Problemen**:

- **E-Mail**: support@banz-jahresabschluss.example
- **Tel**: +49 (xxx) xxxxxxx (Mo-Fr 9-17 Uhr)
- **Dringend**: security@banz-jahresabschluss.example

**Reaktionszeiten**:
- Pilot-Kanzlei: < 4 Stunden (Werktags)
- Sicherheits-Vorfall: < 1 Stunde

---

**Dokument-Version**: 1.0.0 (M1)
**Reviewer**: Pilot-Kanzlei + Mavis
**Nächste Aktualisierung**: Nach M2 (BAnz-Submission)