// ══════════════════════════════════════════════
// CYCLE ANALYSIS ENGINE
// ══════════════════════════════════════════════
//
// Diese Datei bildet den Kern der Zyklusanalyse nach der
// symptothermalen Methode (NFP – natürliche Familienplanung).
//
// Die Auswertung kombiniert zwei Kriterien:
//   • Zervixschleim: Höhepunkt der Schleimqualität (Peak Day)
//   • Temperatur:  Temperaturanstieg nach dem Schleimhöhepunkt
//
// Alle Messungen nach dem Schleimhöhepunkt werden ausgewertet:
// Jede Messung, deren Temperatur höher ist als die 6 vorangegangenen
// Messungen, gilt als umrandet. Sobald 3 umrandete Messungen erreicht
// sind, gilt der 4. Tag als sicher unfruchtbar bis zur nächsten Blutung.
//
// Alle Tage werden grundsätzlich als unfruchtbar angenommen.
//
// Datenmodell (entries):
//   Ein Objekt, das jedem Datum (String "YYYY-MM-DD") einen Eintrag zuordnet:
//     bleeding     – 1–5 wenn Blutung (Intensität), 0 sonst
//     spotting     – true wenn Schmierblutung (kein Zyklusbeginn)
//     temperature  – Basaltemperatur als String (z.B. "36,60")
//     tempExclude  – true wenn Temperaturwert gestört (Krankheit, Alkohol etc.)
//     mucus        – Schleimqualität: 0=keine Angabe, 1=trocken, 2=∅, 3=fließend, 4=S, 5=S+
//     mucusExclude – true wenn Schleimbeobachtung gestört
//
// ── Datumshilfsfunktionen ──
// Alle Daten werden intern als Strings im Format "YYYY-MM-DD" verarbeitet,
// um Zeitzonenprobleme und Sommerzeit-Umstellung zu vermeiden.

const fmt = d => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const parseLocal = ds => {
  const p = ds.split('-');
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
};
const daysBetween = (a, b) => Math.round((parseLocal(b) - parseLocal(a)) / 86400000);
const addDays = (ds, n) => {
  const p = ds.split('-');
  const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  d.setDate(d.getDate() + n);
  return fmt(d);
};

// ───────────────────────────────
// Temperatur-Rundung (0.05°C)
// ───────────────────────────────
function roundTemp(t) { return Math.round(t * 20) / 20; }

// ───────────────────────────────
// UI-Hilfskonstanten
// ───────────────────────────────

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const DAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const nowTime = () => new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

// getDaysInMonth(y, m) → Anzahl Tage in Monat m (0=Januar) des Jahres y.
// Trick: Tag 0 des Folgemonats ist der letzte Tag des aktuellen Monats.
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

// getFirstDayOfWeek(y, m) → Wochentag des 1. Tages im Monat als 0=Mo … 6=So.
// JavaScript (getDay): 0=So, 1=Mo, … → Umrechnung auf Montag=0.
function getFirstDayOfWeek(y, m) { const d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; }

// ───────────────────────────────
// Schleimqualität / Zervixschleim
// ───────────────────────────────
const MUCUS = [
  { short: "t",  tip: "Trocken" },                                   // mucus = 1
  { short: "∅",  tip: "Nichts gefühlt" },                            // mucus = 2
  { short: "f",  tip: "Fliesst" },                                   // mucus = 3
  { short: "S",  tip: "Weisslich, dicklich, cremig, klebrig" },      // mucus = 4
  { short: "S+", tip: "Fadenziehend, glasklar, wie Eiweiss" }        // mucus = 5  ← beste Qualität (Peak-fähig)
];

// ═════════════════════════════════════════════════════════════
// ZYKLUSERKENNUNG
// ═════════════════════════════════════════════════════════════
//
// Ein Zyklus beginnt am ersten Tag einer Blutung und endet
// einen Tag vor der nächsten Blutung. Der aktuelle (laufende)
// Zyklus hat kein Enddatum und keine Länge.

// detectCycles(entries) → Array von Zyklus-Objekten [{start, end, length, ongoing}].
// Algorithmus:
//   1. Alle Daten chronologisch sortieren.
//   2. Jeden Blutungstag erfassen:
//      – Erster Blutungstag (oder erster nach non‑bleeding) → neuer Zyklusbeginn.
//      – Inkonsekutive Blutungstage (Lücke >1 Tag) → gilt ebenfalls als neuer Zyklusbeginn
//        (z.B. wenn eine Blutung pausiert und wieder einsetzt).
//   3. Jedem Start den Folgestart minus 1 Tag als Ende zuweisen.
//      Der letzte Zyklus hat kein Ende (ongoing=true).
function detectCycles(entries) {
  const allDates = Object.keys(entries).sort();
  if (!allDates.length) return [];
  const starts = [];
  let inBleeding = false;
  let lastProcessedDate = null;
  for (const d of allDates) {
    const b = (entries[d]?.bleeding ?? 0) > 0 && !entries[d]?.spotting;
    if (b && !inBleeding) {
      starts.push(d);
      inBleeding = true;
    } else if (b && inBleeding && lastProcessedDate) {
      if (daysBetween(lastProcessedDate, d) > 1) starts.push(d);
    }
    if (!b) inBleeding = false;
    lastProcessedDate = d;
  }
  const cycles = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i < starts.length - 1 ? addDays(starts[i + 1], -1) : null;
    const length = end ? daysBetween(start, end) + 1 : null;
    cycles.push({ start, end, length, ongoing: !end });
  }
  return cycles;
}

// getCycleDates(cycle, entries) → Alle Datumsstrings eines Zyklus, von Start bis Ende (bzw. heute wenn laufend).
function getCycleDates(cycle, entries) {
  const dates = [];
  const endDate = cycle.end || fmt(new Date());
  let d = cycle.start;
  while (d <= endDate) { dates.push(d); d = addDays(d, 1); }
  return dates;
}

// ═════════════════════════════════════════════════════════════
// TEMPERATURANALYSE – 3-über-6-Regel
// ═════════════════════════════════════════════════════════════
//
// Die Basaltemperatur steigt nach dem Eisprung durch Progesteron
// um ca. 0,2–0,5 °C an. Die 3-über-6-Regel erkennt diesen Anstieg:
//
//   Regel: 3 aufeinanderfolgende Temperaturwerte müssen alle über
//          der Hilfslinie (Coverline) liegen. Die Coverline ist das
//          Maximum der 6 vorangegangenen Werte. Der 3. hohe Wert
//          muss mindestens 0,2 °C über der Coverline liegen.
//
// Die Prüfung startet erst nach dem Schleimhöhepunkt (mucusPeakDate).
// Wenn kein Schleimhöhepunkt bekannt, wird der gesamte Zyklus geprüft.
//
// Rückgabe: { confirmed: true, coverline, shiftDay, confirmDate }
//           oder { confirmed: false } wenn nicht genug Daten / kein Anstieg.
function analyzeTemp(cycle, entries, mucusPeakDate) {
  const dates = getCycleDates(cycle, entries);
  const temps = dates.map(d => {
    const e = entries[d];
    if (!e || !e.temperature || e.tempExclude) return null;
    return { date: d, temp: roundTemp(parseFloat(e.temperature)), cycleDay: daysBetween(cycle.start, d) + 1 };
  }).filter(Boolean);

  if (temps.length < 9) return { confirmed: false };

  let scanStart = 6;
  if (mucusPeakDate) {
    for (let k = 0; k < temps.length; k++) {
      if (temps[k].date > mucusPeakDate) { scanStart = Math.max(6, k); break; }
    }
  }

  for (let i = scanStart; i <= temps.length - 3; i++) {
    const low6 = temps.slice(i - 6, i);
    const high3 = temps.slice(i, i + 3);
    const coverline = Math.max(...low6.map(t => t.temp));
    const allAbove = high3.every(t => t.temp > coverline);
    if (!allAbove) continue;
    const third = high3[2];
    if (Math.round(third.temp * 20) >= Math.round((coverline + 0.2) * 20)) {
      return { confirmed: true, coverline, shiftDay: third.cycleDay, confirmDate: third.date };
    }
  }
  return { confirmed: false };
}

// ═════════════════════════════════════════════════════════════
// SCHLEIMANALYSE – Peak Day
// ═════════════════════════════════════════════════════════════
//
// Der Zervixschleim verändert sich im Zyklusverlauf:
//   t (0) = trocken       → unfruchtbar
//   ∅ (1) = nichts gefühlt → Übergangsqualität
//   f (2) = fließend       → Übergangsqualität
//   S (3) = weißlich, cremig → bessere Qualität
//   S+(4) = spinnbar, glasklar → beste Qualität (Östrogenpeak)
//
// Der Peak Day ist der letzte Tag mit der besten Schleimqualität
// im Zyklus. Nach dem Peak fallen Östrogen und Schleimqualität ab.
//
// Suchalgorithmus (von hinten nach vorne):
//   1. Zuerst nach Schleimqualität ≥ 5 (S+) suchen.
//      Peak = letzter Tag mit S+, nach dem kein S+ mehr folgt.
//   2. Falls kein S+ vorhanden, suche nach Qualität ≥ 4 (S).
//      Peak = letzter Tag mit S, nach dem kein S mehr folgt.
//   3. Ausgeschlossene Tage (mucusExclude) werden übersprungen.
//
// Rückgabe: { found: true, peakDate, peakCycleDay, plus3Date, plus3CycleDay }
//           oder { found: false } wenn kein Peak gefunden.
function analyzeMucus(cycle, entries) {
  const dates = getCycleDates(cycle, entries);
  const mucusData = dates.map(d => {
    const e = entries[d];
    return { date: d, mucus: e?.mucus || 0, exclude: e?.mucusExclude || false, cycleDay: daysBetween(cycle.start, d) + 1 };
  });

  let peakIdx = -1;
  for (let i = mucusData.length - 1; i >= 0; i--) {
    if (mucusData[i].exclude) continue;
    if (mucusData[i].mucus >= 5) {
      let nextIdx = -1;
      for (let j = i + 1; j < mucusData.length; j++) {
        if (!mucusData[j].exclude) { nextIdx = j; break; }
      }
      if (nextIdx === -1 || mucusData[nextIdx].mucus < mucusData[i].mucus) {
        peakIdx = i; break;
      }
    }
  }

  if (peakIdx === -1) {
    for (let i = mucusData.length - 1; i >= 0; i--) {
      if (mucusData[i].exclude) continue;
      if (mucusData[i].mucus >= 4) {
        let nextIdx = -1;
        for (let j = i + 1; j < mucusData.length; j++) {
          if (!mucusData[j].exclude) { nextIdx = j; break; }
        }
        if (nextIdx === -1 || mucusData[nextIdx].mucus < mucusData[i].mucus) {
          peakIdx = i; break;
        }
      }
    }
  }

  if (peakIdx === -1) return { found: false };
  const peak = mucusData[peakIdx];
  const plus3Date = addDays(peak.date, 3);
  const plus3CycleDay = peak.cycleDay + 3;
  return { found: true, peakDate: peak.date, peakCycleDay: peak.cycleDay, plus3Date, plus3CycleDay };
}

// ═════════════════════════════════════════════════════════════
// KOMBINIERTE ANALYSE – Umrandeter Tag
// ═════════════════════════════════════════════════════════════
//
// Ein Zyklus wird nur ausgewertet, wenn sowohl Temperatur- als auch
// Schleimdaten vorhanden sind. Fehlt eines der Kriterien, gilt der
// Zyklus als nicht ausgewertet.
//
//   1. Schleimhöhepunkt (Peak Day) bestimmen (zwingend erforderlich).
//
//   2. Fixe Coverline: Maximum der 6 Tiefstwerte VOR dem Schleimhöhepunkt
//      (Follikelphase). Kein gleitendes Fenster.
//
//   3. Temperaturprüfung gegen die fixe Coverline:
//      Jede Messung nach dem Peak, deren Temperatur über der Coverline
//      liegt, gilt als "umrandet".
//
//   4. Zusätzlich 6-3-Regel gegen die fixe Coverline:
//      3 aufeinanderfolgende Werte über der Coverline,
//      3. Wert mindestens 0,2 °C über der Coverline.
//
//   5. Sobald 3 umrandete Messungen erreicht sind, gilt der 4. Tag
//      (Tag nach der 3. umrandeten) als sicher unfruchtbar bis zur
//      nächsten Blutung.
function analyzeUmrandeterTag(cycle, entries) {
  const mucus = analyzeMucus(cycle, entries);
  if (!mucus.found) return { found: false, mucus, criteria: { mucusPeak: { met: false, label: 'Schleimhöhepunkt', detail: 'Kein Schleimhöhepunkt (S+ oder S) im Zyklus gefunden.' } } };

  const dates = getCycleDates(cycle, entries);
  const temps = dates.map(d => {
    const e = entries[d];
    if (!e || !e.temperature || e.tempExclude) return null;
    return { date: d, temp: roundTemp(parseFloat(e.temperature)), cycleDay: daysBetween(cycle.start, d) + 1 };
  }).filter(Boolean);

  if (temps.length < 9) return {
    found: false, mucus,
    criteria: {
      mucusPeak: { met: true, label: 'Schleimhöhepunkt', detail: 'Schleimhöhepunkt gefunden: ' + MUCUS[mucusPeakQuality(mucus)].short + ' an Tag ' + mucus.peakCycleDay },
      enoughTemps: { met: false, label: 'Temperaturwerte', detail: 'Nur ' + temps.length + ' Temperaturwerte vorhanden (mindestens 9 benötigt).' }
    }
  };

  function mucusPeakQuality(m) {
    const e = entries[m.peakDate];
    return (e?.mucus || 4) - 1;
  }

  // ── Fixe Coverline: 6 Tiefstwerte VOR dem Schleimhöhepunkt (Follikelphase) ──
  const prePeak = [];
  for (let k = temps.length - 1; k >= 0 && prePeak.length < 6; k--) {
    if (temps[k].date < mucus.peakDate) prePeak.unshift(temps[k]);
  }
  if (prePeak.length < 6) return {
    found: false, mucus,
    criteria: {
      mucusPeak: { met: true, label: 'Schleimhöhepunkt', detail: 'Schleimhöhepunkt gefunden: ' + MUCUS[mucusPeakQuality(mucus)].short + ' an Tag ' + mucus.peakCycleDay },
      enoughTemps: { met: true, label: 'Temperaturwerte', detail: temps.length + ' Temperaturwerte vorhanden (min. 9 benötigt).' },
      prePeakTemps: { met: false, label: 'Tiefstwerte vor Peak', detail: 'Nur ' + prePeak.length + ' Temperaturwerte vor dem Schleimhöhepunkt (6 benötigt).' }
    }
  };
  const fixedCoverline = Math.max(...prePeak.map(t => t.temp));

  // Scan-Start = erster Tag nach dem Schleimhöhepunkt
  let scanStart = 6;
  for (let k = 0; k < temps.length; k++) {
    if (temps[k].date > mucus.peakDate) { scanStart = k; break; }
  }

  // ─ Schritt 1: Jeden Tag gegen die FIXE Coverline prüfen ─
  const umrandetDays = [];
  for (let i = scanStart; i < temps.length; i++) {
    if (temps[i].temp > fixedCoverline) {
      umrandetDays.push(temps[i]);
    }
  }

  // ─ Schritt 2: 6-3-Regel prüfen (gegen die fixe Coverline) ─
  let sixThreeFound = false;
  for (let i = scanStart; i <= temps.length - 3; i++) {
    const high3 = temps.slice(i, i + 3);
    if (high3.every(t => t.temp > fixedCoverline) && Math.round(high3[2].temp * 20) >= Math.round((fixedCoverline + 0.2) * 20)) {
      sixThreeFound = true;
      break;
    }
  }

  let neededUmrandet = 3;
  let fourReason = null;
  if (umrandetDays.length >= 3 && Math.round(umrandetDays[2].temp * 20) < Math.round((fixedCoverline + 0.2) * 20)) {
    neededUmrandet = 4;
    fourReason = 'Die 3. umrandete Messung (' + umrandetDays[2].temp.toFixed(2).replace('.', ',') + '°C) liegt nicht mindestens 0,2°C über der Coverline (' + fixedCoverline.toFixed(2).replace('.', ',') + ' + 0,2 = ' + (fixedCoverline + 0.2).toFixed(2).replace('.', ',') + '°C). Deshalb ist eine 4. umrandete Messung erforderlich.';
  }
  if (umrandetDays.length < neededUmrandet) {
    const prePeakInfo = prePeak.map(t => t.temp.toFixed(2).replace('.', ',') + '°C').join(', ');
    const umrInfo = umrandetDays.map(t => 'Tag ' + t.cycleDay + ' (' + t.temp.toFixed(2).replace('.', ',') + '°C)').join(', ');
    return {
      found: false, mucus,
      criteria: {
        mucusPeak: { met: true, label: 'Schleimhöhepunkt', detail: 'Schleimhöhepunkt gefunden: ' + MUCUS[mucusPeakQuality(mucus)].short + ' an Tag ' + mucus.peakCycleDay },
        enoughTemps: { met: true, label: 'Temperaturwerte', detail: temps.length + ' Temperaturwerte vorhanden (min. 9 benötigt).' },
        prePeakTemps: { met: true, label: 'Tiefstwerte vor Peak (Coverline)', detail: 'Coverline: ' + fixedCoverline.toFixed(2).replace('.', ',') + '°C (Maximum der 6 Tiefstwerte vor dem Peak: ' + prePeakInfo + ').' },
        threeEncircled: { met: false, label: '3 umrandete Messungen', detail: 'Nur ' + umrandetDays.length + ' umrandete Messung(en) nach dem Peak: ' + (umrInfo || 'keine') + '. Benötigt: ' + neededUmrandet + '.' + (fourReason ? ' ' + fourReason : '') }
      }
    };
  }

  // ─ Schritt 3: benötigte umrandete Tage → nächster Tag unfruchtbar bis nächste Blutung ─
  const lastRequired = umrandetDays[neededUmrandet - 1];
  const infertileDate = addDays(lastRequired.date, 1);

  const tempResult = {
    confirmed: sixThreeFound,
    coverline: fixedCoverline,
    shiftDay: lastRequired.cycleDay,
    confirmDate: lastRequired.date,
    umrandetDays
  };

  const prePeakInfo = prePeak.map(t => t.temp.toFixed(2).replace('.', ',') + '°C (Tag ' + t.cycleDay + ')').join(', ');
  const umrInfo = umrandetDays.map(t => 'Tag ' + t.cycleDay + ': ' + t.temp.toFixed(2).replace('.', ',') + '°C').join(', ');
  const thirdCheck = Math.round(umrandetDays[2].temp * 20) >= Math.round((fixedCoverline + 0.2) * 20);

  const criteria = {
    mucusPeak: { met: true, label: 'Schleimhöhepunkt', detail: 'Schleimhöhepunkt gefunden: ' + MUCUS[mucusPeakQuality(mucus)].short + ' an Tag ' + mucus.peakCycleDay + '.' },
    enoughTemps: { met: true, label: 'Temperaturwerte', detail: temps.length + ' Temperaturwerte vorhanden (min. 9 benötigt).' },
    prePeakTemps: { met: true, label: 'Tiefstwerte vor Peak (Coverline)', detail: 'Coverline = ' + fixedCoverline.toFixed(2).replace('.', ',') + '°C. Die 6 tiefsten Messungen vor dem Peak: ' + prePeakInfo + '. Die Coverline ist das Maximum dieser 6 Werte.' },
    threeEncircled: { met: true, label: '3 umrandete Messungen nach Peak', detail: umrandetDays.length + ' umrandete Messung(en) gefunden: ' + umrInfo + '.' },
    thirdAboveThreshold: { met: thirdCheck, label: '3. Messung ≥ Coverline + 0,2°C', detail: thirdCheck
      ? 'Die 3. umrandete Messung (' + umrandetDays[2].temp.toFixed(2).replace('.', ',') + '°C) liegt ≥ ' + (fixedCoverline + 0.2).toFixed(2).replace('.', ',') + '°C (Coverline + 0,2). ✓'
      : 'Die 3. umrandete Messung (' + umrandetDays[2].temp.toFixed(2).replace('.', ',') + '°C) liegt unter ' + (fixedCoverline + 0.2).toFixed(2).replace('.', ',') + '°C (Coverline + 0,2).' },
    threeOrFour: { met: true, label: 'Bestätigung (3 oder 4)', detail: neededUmrandet === 3
      ? '3 umrandete Messungen sind ausreichend, da die 3. Messung mindestens 0,2°C über der Coverline liegt.'
      : '4 umrandete Messungen benötigt. ' + fourReason },
    result: { label: 'Ergebnis', detail: 'Unfruchtbar ab Tag ' + (daysBetween(cycle.start, infertileDate) + 1) + ' (' + infertileDate + ').' }
  };

  return {
    found: true, temp: tempResult, mucus, criteria,
    umrandetDate: umrandetDays[0].date,
    umrandetCycleDay: umrandetDays[0].cycleDay,
    infertileFrom: infertileDate
  };
}

// ═════════════════════════════════════════════════════════════
// VOLLSTÄNDIGE ZYKLUSANALYSE
// ═════════════════════════════════════════════════════════════
//
// Führt für alle erkannten Zyklen die kombinierte Analyse durch.
// Jeder Zyklus wird um Temperatur-, Schleim- und Umrandeter-Tag-Daten ergänzt.
function fullAnalysis(entries, excludedCycles) {
  const cycles = detectCycles(entries);
  const exSet = excludedCycles || [];
  const analyzed = cycles.map(c => {
    const a = analyzeUmrandeterTag(c, entries);
    return { ...c, ...a, excluded: exSet.indexOf(c.start) !== -1 };
  });
  return analyzed;
}

// ═════════════════════════════════════════════════════════════
// FRUCHTBARKEITSBERECHNUNG
// ═════════════════════════════════════════════════════════════
//
// computeFertility() ordnet jedem Tag des aktuellen Zyklus
// einen Fruchtbarkeitsstatus zu: "infertile" oder "fertile".
// Grundsätzlich werden alle Tage als unfruchtbar angenommen.
//
// Die Berechnung hat zwei Komponenten:
//
//
// ① ENDE DER FRUCHTBAREN PHASE (endFertileDate)
// ─────────────────────────────────────────────
//   Basierend auf der aktuellen Zyklusanalyse:
//     • 3 umrandete Messungen erreicht → endFertileDate = Tag nach der 3. umrandeten
//       Messung (sicher unfruchtbar bis zur nächsten Blutung)
//     • Nur Schleim-Peak vorhanden → endFertileDate = Peak + 3 Tage
//     • Nichts vorhanden → endFertileDate = null (kein Ende bekannt)
//
//
// ② SICHERE TAGE AM ZYKLUSANFANG (safeDays)
// ──────────────────────────────────────────
//   Nur bei ausreichender Datenbasis (≥12 Zyklen). Bei weniger als 12 Zyklen
//   werden keine anderen Regeln verwendet.
//
//   a) sehrSicherBis – basierend auf Zykluslängen:
//      ≥12 Zyklen: kürzester Zyklus − 20 Tage
//
//   b) sicherBis – basierend auf frühestem Eisprung in der Historie (Döring):
//      ≥12 ausgewertete Zyklen: frühester umrandeterTag − 8 Tage
//
//   safeDays = Math.max(sehrSicherBis, sicherBis)
//
//
// ③ TAG-FÜR-TAG-KLASSIFIZIERUNG
// ──────────────────────────────
//   Für jeden Tag des Zyklus (bis heute bei laufendem Zyklus):
//   Alle Tage gelten grundsätzlich als unfruchtbar.
//
//   Ausnahmen ("fertile"):
//     • endFertileDate vorhanden und d < endFertileDate
//       (vor dem bestätigten Eisprung → fruchtbar)
//
// Rückgabe: { result, sehrSicherBis, sicherBis, safeDays, endFertileDate,
//             totalRecentCycles, evaluatedRecentCount }
function computeFertility(currentCycle, allAnalyzed, entries) {
  const today = fmt(new Date());
  const dates = getCycleDates(currentCycle, entries);
  const result = {};

  // ── ① Ende der fruchtbaren Phase im aktuellen Zyklus ──
  const thisAnalysis = allAnalyzed.find(a => a.start === currentCycle.start);
  let endFertileDate = null;
  if (thisAnalysis?.found) {
    endFertileDate = thisAnalysis.infertileFrom;
  } else if (thisAnalysis?.mucus?.found) {
    endFertileDate = thisAnalysis.mucus.plus3Date;
  }

  // ── ② Sichere Tage am Zyklusanfang aus der Historie ──
  const allCompleted = allAnalyzed.filter(c => c.length && !c.excluded);
  const totalRecentCycles = allCompleted.length;
  const evaluatedRecent = allCompleted.filter(c => c.found);

  let sehrSicherBis = 0;
  let sicherBis = 0;

  // sehrSicherBis: basierend auf kürzester Zykluslänge (≥12 Zyklen: kürzester − 20)
  if (totalRecentCycles >= 12) {
    const lengths = allCompleted.map(c => c.length);
    const shortest = Math.min(...lengths);
    sehrSicherBis = Math.max(0, shortest - 20);
  }

  // sicherBis: basierend auf frühestem beobachteten Eisprung (≥12 ausgewertete Zyklen: Döring — frühester umrandeterTag − 8)
  if (evaluatedRecent.length >= 12) {
    const umrandetDays = evaluatedRecent.map(c => c.umrandetCycleDay).filter(Boolean);
    const earliest = Math.min(...umrandetDays);
    sicherBis = Math.max(0, earliest - 8);
  }

  // Der größere der beiden Werte zählt – liefert mehr Sicherheit
  const safeDays = Math.max(sehrSicherBis, sicherBis);

  // ── ③ Tag-für-Tag-Klassifizierung ──
  for (const d of dates) {
    // Bei laufendem Zyklus nur bis heute bewerten
    if (d > today && currentCycle.ongoing) break;
    const cd = daysBetween(currentCycle.start, d) + 1;

    if (endFertileDate && d >= endFertileDate) {
      result[d] = "infertile";
    } else if (cd <= safeDays) {
      // 2. Priorität: am Zyklusanfang laut Historie sicher
      result[d] = "infertile";
    } else if (endFertileDate && d < endFertileDate) {
      // 3. Priorität: im fruchtbaren Fenster (zwischen safeDays und Eisprung)
      result[d] = "fertile";
    } else {
      result[d] = "infertile";
    }
  }

  return { result, sehrSicherBis, sicherBis, safeDays, endFertileDate, totalRecentCycles, evaluatedRecentCount: evaluatedRecent.length };
}

// ═════════════════════════════════════════════════════════════
// VORHERSAGE DER NÄCHSTEN MENSTRUATION
// ═════════════════════════════════════════════════════════════
//
// Sobald der erste umrandete Tag im aktuellen Zyklus bestimmt ist,
// kann das Datum der nächsten Menstruation auf zwei Weisen
// vorhergesagt werden:
//
//   ① Basierend auf der durchschnittlichen Zykluslänge:
//      nächste Menstruation = Zyklusbeginn + Ø-Zykluslänge
//
//   ② Basierend auf der durchschnittlichen unfruchtbaren Phase:
//      Für abgeschlossene, ausgewertete Zyklen wird die Dauer
//      vom unfruchtbar-ab-Tag bis zum Zyklusende gemittelt.
//      nächste Menstruation = aktuelles infertileFrom + Ø-Dauer
//
// Rückgabe: { canPredict: bool, avgCycleLength, nextFromLength,
//             avgInfertilePhase, nextFromInfertile, completedCount }
function predictNextMenstruation(currentCycle, allAnalyzed, entries) {
  const thisAnalysis = allAnalyzed.find(a => a.start === currentCycle.start);
  if (!thisAnalysis || !thisAnalysis.found) return { canPredict: false };

  const infertileFrom = thisAnalysis.infertileFrom;
  const completed = allAnalyzed.filter(c => c.length && c.found && !c.excluded);

  if (!completed.length) return { canPredict: false };

  const totalLength = completed.reduce((sum, c) => sum + c.length, 0);
  const avgCycleLength = Math.round(totalLength / completed.length);
  const nextFromLength = addDays(currentCycle.start, avgCycleLength);

  const infPhases = completed.map(c => {
    const infFromCD = daysBetween(c.start, c.infertileFrom) + 1;
    return c.length - infFromCD + 1;
  });
  const totalInf = infPhases.reduce((sum, p) => sum + p, 0);
  const avgInfertilePhase = Math.round(totalInf / infPhases.length);
  const nextFromInfertile = addDays(infertileFrom, avgInfertilePhase);

  return {
    canPredict: true,
    avgCycleLength,
    nextFromLength,
    avgInfertilePhase,
    nextFromInfertile,
    completedCount: completed.length
  };
}
