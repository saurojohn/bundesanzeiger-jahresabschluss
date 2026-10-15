'use client';

import { useEffect, useRef, useState } from 'react';
import { formatZahl, parseZahl } from '@/lib/zahl';

/**
 * Betragsfeld im deutschen Zahlenformat.
 *
 * BEFUND 2026-10-15: Als `<input type="number">` verarbeitete, gemessen im
 * Browser:
 *
 *   "1.500"     -> gespeichert als 1,5      (Faktor 1000 daneben)
 *   "150000,50" -> das Komma wird verworfen
 *
 * `type="number"` kann das nicht aufloesen — "1.500" ist dort ein zulaessiger
 * Wert, und die Absicht ist nicht erkennbar. Ein Textfeld mit expliziter
 * Aufloesung schon.
 *
 * Zwei Regeln, die zusammen den Fehler unwahrscheinlich machen:
 *   1. Beim Verlassen des Feldes wird auf `formatZahl` normalisiert — der
 *      angezeigte Wert IST danach der gespeicherte. Wer "1.500" tippt, sieht
 *      anschliessend "1.500,00". Wollte er 1,5, sieht er es sofort.
 *   2. Eine unparsebare Eingabe wird NICHT still zu 0. Sie bleibt als Text
 *      stehen und wird rot markiert, und der gespeicherte Wert bleibt
 *      unveraendert.
 *
 * EIGENER FEHLER, im ersten Entwurf (gemessen):
 * `roh` wurde bei jeder Tastatureingabe gesetzt, gleichzeitig änderte sich
 * `wert` vom Vater, der Effekt auf `[wert]` raeumte `roh` wieder — und die
 * Anzeige sprang mitten im Tippen auf den formatierten Zahlenwert zurueck:
 *
 *   "150000,50" -> "1,01000,50"
 *
 * Deshalb haelt der Vektor den zuletzt selbst gesendeten Wert. Nur eine
 * Aenderung, die NICHT von diesem Feld kommt, ueberschreibt den Rohtext.
 */
export function BetragInput({
  wert,
  onWert,
  disabled,
  required = false,
  platzhalter,
  ariaLabel,
  nachkommaStellen = 2,
}: {
  wert: number | null | undefined;
  onWert: (v: number | null) => void;
  disabled?: boolean;
  required?: boolean;
  platzhalter?: string;
  ariaLabel?: string;
  /**
   * 2 fuer Geldbetraege, 0 fuer ganze Zahlen wie Mitarbeiterzahl oder
   * Beteiligungsquote. Dieselbe deutsche Aufloesung gilt fuer beide; nur die
   * Anzeige unterscheidet sich.
   */
  nachkommaStellen?: 0 | 2;
}) {
  const [roh, setRoh] = useState<string | null>(null);
  const [ungueltig, setUngueltig] = useState(false);
  const selbstGesendet = useRef<number | null | undefined>(wert);

  useEffect(() => {
    // Nur ueberschreiben, wenn der Wert von AUSSEN kommt. Der eigene
    // Sendewert darf das nicht — sonst springt die Anzeige beim Tippen.
    //
    // Sonderfall leeres Pflichtfeld: Das Elternteil macht aus `null` eine 0
    // (`betragAktuell: v ?? 0`), weil das DTO eine Zahl verlangt. Ohne diese
    // Sonderregel wuerde beim Leeren des Feldes `roh` geloescht und sofort
    // "0,00" angezeigt — die naechste Eingabe landete dann an dieser
    // Ziffer. Gemessen: "0,001234,56" und gespeichert wurde 0.
    const leerZuNull = selbstGesendet.current === null && wert === 0;
    if (wert !== selbstGesendet.current && !leerZuNull) {
      setRoh(null);
      setUngueltig(false);
    }
    selbstGesendet.current = wert;
  }, [wert]);

  const anzeige = roh ?? formatZahl(wert, nachkommaStellen);

  function handleChange(text: string) {
    setRoh(text);

    if (text.trim() === '') {
      setUngueltig(false);
      selbstGesendet.current = null;
      onWert(null);
      return;
    }

    const zahl = parseZahl(text);
    if (zahl === null) {
      // Umlautfehler: nichts senden, aber den Text stehen lassen, damit
      // der Nutzer fertig tippen kann.
      setUngueltig(true);
      return;
    }
    setUngueltig(false);
    selbstGesendet.current = zahl;
    onWert(zahl);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      aria-invalid={ungueltig}
      placeholder={platzhalter}
      value={anzeige}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => {
        // Normalisieren: ab hier steht der angezeigte Wert fuer den
        // gespeicherten.
        setRoh(null);
        setUngueltig(false);
      }}
      className={
        'block w-full text-right rounded border px-2 py-1 text-sm num-de ' +
        'disabled:bg-slate-50 disabled:text-slate-500 ' +
        'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ' +
        (ungueltig ? 'border-red-500 bg-red-50 text-red-900' : 'border-slate-200')
      }
    />
  );
}
