// ══════════════════════════════════════════════
// CYCLE ANALYSIS ENGINE
// ══════════════════════════════════════════════
//
// Diese Datei bildet den Kern der Zyklusanalyse nach der
// symptothermalen Methode (NFP – natürliche Familienplanung).
//
// Die Auswertung kombiniert zwei Kriterien:
//   • Zervixschleim: Schleimhöhepunkt (letzter Tag bester Qualität)
//   • Temperatur:  Temperaturanstieg + umrandete Messungen
//
// Ablauf der Auswertung nach dem Eisprung:
//   1. Schleimhöhepunkt: letzter Tag mit bester Schleimqualität
//   2. Temperaturanstieg: erste Messung > 6 vorangegangene Messungen
//   3. Basislinie: höchste der 6 Messungen vor dem Temperaturanstieg
//   4. 1. umrandete Messung: erste Messung > Coverlinie, nach Schleimhöhepunkt
//   5. 2. + 3. umrandete Messung suchen (max. 1 Ausnahme erlaubt)
//   6. 0,2 °C-Regel: 3. umrandete ≥ Coverlinie + 0,2 °C?
//      Ja → unfruchtbar ab Abend der 3. umrandeten Messung
//      Nein → 4. umrandete Messung abwarten
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

var fmt = function(d) {
  var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
};
var parseLocal = function(ds) {
  var p = ds.split('-');
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
};
var daysBetween = function(a, b) { return Math.round((parseLocal(b) - parseLocal(a)) / 86400000); };
var addDays = function(ds, n) {
  var p = ds.split('-');
  var d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
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

var MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
var DAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

function getFirstDayOfWeek(y, m) { var d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; }

// ───────────────────────────────
// Schleimqualität / Zervixschleim
// ───────────────────────────────
var MUCUS = [
  { short: "t",  tip: "Trocken" },
  { short: "∅",  tip: "Nichts gefühlt" },
  { short: "f",  tip: "Fliesst" },
  { short: "S",  tip: "Weisslich, dicklich, cremig, klebrig" },
  { short: "S+", tip: "Fadenziehend, glasklar, wie Eiweiss" }
];

// ═════════════════════════════════════════════════════════════
// ZYKLUSERKENNUNG
// ═════════════════════════════════════════════════════════════
//
// Ein Zyklus beginnt am ersten Tag einer Blutung und endet
// einen Tag vor der nächsten Blutung. Der aktuelle (laufende)
// Zyklus hat kein Enddatum und keine Länge.

function detectCycles(entries) {
  var allDates = Object.keys(entries).sort();
  if (!allDates.length) return [];
  var starts = [];
  var inBleeding = false;
  var lastProcessedDate = null;
  for (var di = 0; di < allDates.length; di++) {
    var d = allDates[di];
    var b = (entries[d] && entries[d].bleeding || 0) > 0 && !(entries[d] && entries[d].spotting);
    if (b && !inBleeding) {
      starts.push(d);
      inBleeding = true;
    } else if (b && inBleeding && lastProcessedDate) {
      if (daysBetween(lastProcessedDate, d) > 1) starts.push(d);
    }
    if (!b) inBleeding = false;
    lastProcessedDate = d;
  }
  var cycles = [];
  for (var i = 0; i < starts.length; i++) {
    var start = starts[i];
    var end = i < starts.length - 1 ? addDays(starts[i + 1], -1) : null;
    var length = end ? daysBetween(start, end) + 1 : null;
    cycles.push({ start: start, end: end, length: length, ongoing: !end });
  }
  return cycles;
}

function getCycleDates(cycle, entries) {
  var dates = [];
  var endDate = cycle.end || fmt(new Date());
  var d = cycle.start;
  while (d <= endDate) { dates.push(d); d = addDays(d, 1); }
  return dates;
}

// ═════════════════════════════════════════════════════════════
// TEMPERATURANALYSE – Temperaturanstieg
// ═════════════════════════════════════════════════════════════
//
// Die erste Messung im Zyklus suchen, die höher ist als sechs
// vorangegangene Messungen. Dieser Tag heisst "Temperaturanstieg".
//
// Die sechs Tage davor werden zurücknummeriert und die Basislinie
// (Coverlinie) ist die höchste dieser 6 Messungen. Maximal eine
// fehlende Messung ist erlaubt, aber nicht am ersten der 6 Tage.
// Fehlt eine Messung, wird ein zusätzlicher Tag zurückgegangen.
//
// Rückgabe: { confirmed: true, coverline, fhmCycleDay, fhmDate }
//           oder { confirmed: false }

function analyzeTemp(cycle, entries) {
  var dates = getCycleDates(cycle, entries);

  var allDays = dates.map(function(d) {
    var e = entries[d];
    if (!e || !e.temperature || e.tempExclude) return { date: d, temp: null, cycleDay: daysBetween(cycle.start, d) + 1 };
    return { date: d, temp: roundTemp(parseFloat(e.temperature)), cycleDay: daysBetween(cycle.start, d) + 1 };
  });

  var validTemps = allDays.filter(function(d) { return d.temp !== null; });
  if (validTemps.length < 7) return { confirmed: false };

  var cdToIdx = {};
  for (var i = 0; i < allDays.length; i++) {
    cdToIdx[allDays[i].cycleDay] = i;
  }

  // Erste Messung suchen, die höher ist als die 6 vorangegangenen
  for (var vi = 0; vi < validTemps.length; vi++) {
    var candidate = validTemps[vi];
    if (candidate.cycleDay < 7) continue;

    var startCD = candidate.cycleDay - 6;
    var endCD = candidate.cycleDay - 1;
    var pre6 = [];
    var missingCount = 0;
    var missingAtStart = false;
    for (var cd = startCD; cd <= endCD; cd++) {
      var idx = cdToIdx[cd];
      if (idx === undefined) {
        missingCount++;
        if (cd === startCD) missingAtStart = true;
        continue;
      }
      var day = allDays[idx];
      if (day.temp !== null) {
        pre6.push(day);
      } else {
        var orig = entries[day.date];
        if (!orig || !orig.tempExclude) {
          missingCount++;
          if (cd === startCD) missingAtStart = true;
        }
      }
    }
    if (missingCount > 1) continue;
    if (missingCount === 1 && missingAtStart) continue;
    // Expand backward to get 6 valid temps (for excluded temps or 1 missing-in-middle)
    var expandCD = startCD - 1;
    while (pre6.length < 6 && expandCD >= 1) {
      var expIdx = cdToIdx[expandCD];
      if (expIdx === undefined) break;
      var expDay = allDays[expIdx];
      if (expDay.temp !== null) {
        pre6.push(expDay);
      } else {
        var expOrig = entries[expDay.date];
        if (!expOrig || !expOrig.tempExclude) break;
      }
      expandCD--;
    }
    if (pre6.length < 6) continue;

    // Basislinie = höchste der 6 vorangegangenen Messungen
    var coverline = Math.max.apply(null, pre6.map(function(t) { return t.temp; }));
    if (candidate.temp <= coverline) continue;

    // Temperaturanstieg gefunden
    return {
      confirmed: true,
      coverline: coverline,
      fhmCycleDay: candidate.cycleDay,
      fhmDate: candidate.date
    };
  }
  return { confirmed: false };
}

// ═════════════════════════════════════════════════════════════
// SCHLEIMANALYSE – Schleimhöhepunkt
// ═════════════════════════════════════════════════════════════
//
// Der Schleimhöhepunkt ist der letzte Tag, welcher den Schleim
// mit der besten Qualität besitzt.
//
// Suchalgorithmus (von hinten nach vorne):
//   1. Zuerst nach S+ (mucus >= 5) suchen.
//      Schleimhöhepunkt = letzter Tag mit S+, nach dem kein S+ mehr folgt.
//   2. Falls kein S+ vorhanden, suche nach S (mucus >= 4).
//      Schleimhöhepunkt = letzter Tag mit S, nach dem kein S mehr folgt.
//   3. Ausgeschlossene Tage (mucusExclude) werden übersprungen.
//
// Rückgabe: { found: true, peakDate, peakCycleDay, plus3Date, plus3CycleDay }
//           oder { found: false }

function analyzeMucus(cycle, entries) {
  var dates = getCycleDates(cycle, entries);
  var mucusData = dates.map(function(d) {
    var e = entries[d];
    return { date: d, mucus: (e && e.mucus) || 0, exclude: (e && e.mucusExclude) || false, cycleDay: daysBetween(cycle.start, d) + 1 };
  });

  var peakIdx = -1;

  // Suche S+ Peak (mucus >= 5)
  for (var i = mucusData.length - 1; i >= 0; i--) {
    if (mucusData[i].exclude) continue;
    if (mucusData[i].mucus >= 5) {
      var nextIdx = -1;
      for (var j = i + 1; j < mucusData.length; j++) {
        if (!mucusData[j].exclude) { nextIdx = j; break; }
      }
      if (nextIdx === -1 || mucusData[nextIdx].mucus < mucusData[i].mucus) {
        peakIdx = i; break;
      }
    }
  }

  // Falls kein S+ Peak, suche S Peak (mucus >= 4)
  if (peakIdx === -1) {
    for (var i2 = mucusData.length - 1; i2 >= 0; i2--) {
      if (mucusData[i2].exclude) continue;
      if (mucusData[i2].mucus >= 4) {
        var nextIdx2 = -1;
        for (var j2 = i2 + 1; j2 < mucusData.length; j2++) {
          if (!mucusData[j2].exclude) { nextIdx2 = j2; break; }
        }
        if (nextIdx2 === -1 || mucusData[nextIdx2].mucus < mucusData[i2].mucus) {
          peakIdx = i2; break;
        }
      }
    }
  }

  if (peakIdx === -1) return { found: false };
  var peak = mucusData[peakIdx];
  var plus3Date = addDays(peak.date, 3);
  var plus3CycleDay = peak.cycleDay + 3;
  return { found: true, peakDate: peak.date, peakCycleDay: peak.cycleDay, plus3Date: plus3Date, plus3CycleDay: plus3CycleDay };
}

// ═════════════════════════════════════════════════════════════
// KOMBINIERTE ANALYSE – Umrandete Messungen
// ═════════════════════════════════════════════════════════════
//
// Ablauf nach dem Eisprung:
//
//   1. Coverlinie (Basislinie) bestimmen – über Temperaturanstieg
//      oder manuelle Festlegung.
//
//   2. Schleimhöhepunkt bestimmen (zwingend erforderlich).
//
//   3. 1. umrandete Messung: erste Messung über der Coverlinie,
//      nach (nicht auf) dem Schleimhöhepunkt.
//
//   4. 2. + 3. umrandete Messung suchen:
//      Die folgenden Messungen nach der 1. umrandeten Messung
//      betrachten. Maximal eine Messung darf auf/unter die
//      Coverlinie fallen (Ausnahme).
//
//   5. 0,2 °C-Regel:
//      Liegt die 3. umrandete Messung ≥ 0,2 °C über der Coverlinie?
//        Ja → unfruchtbar ab Abend (20:00) der 3. umrandeten Messung.
//        Nein → 4. umrandete Messung abwarten (Abend des 4. Tages).
//
function analyzeUmrandeterTag(cycle, entries, manualCoverline) {
  // ── 1. Coverlinie bestimmen ──
  var manualActive = manualCoverline !== undefined && manualCoverline !== null && manualCoverline !== '' && !isNaN(parseFloat(manualCoverline));
  var tempAnalysis;
  var coverline;
  var coverlineDetail;
  if (manualActive) {
    coverline = roundTemp(parseFloat(manualCoverline));
    tempAnalysis = { confirmed: true, coverline: coverline, fhmCycleDay: 0, fhmDate: '' };
    coverlineDetail = 'Coverlinie = ' + coverline.toFixed(2).replace('.', ',') + '°C (manuell festgelegt).';
  } else {
    tempAnalysis = analyzeTemp(cycle, entries);
    if (!tempAnalysis.confirmed) return {
      found: false,
      criteria: {
        coverlineFound: { met: false, label: 'Coverlinie (Temperatur)', detail: 'Kein Temperaturanstieg gefunden. Es wurde keine Messung gefunden, die höher als die 6 vorangegangenen Messungen ist (max. 1 fehlende Messung erlaubt).' }
      }
    };
    coverline = tempAnalysis.coverline;
    coverlineDetail = 'Coverlinie = ' + coverline.toFixed(2).replace('.', ',') + '°C (Temperaturanstieg an Tag ' + tempAnalysis.fhmCycleDay + ', höchste der 6 vorangegangenen Messungen).';
  }

  // ── 2. Schleimhöhepunkt bestimmen ──
  var mucus = analyzeMucus(cycle, entries);
  if (!mucus.found) return {
    found: false, temp: tempAnalysis, mucus: mucus,
    criteria: {
      coverlineFound: { met: true, label: 'Coverlinie (Temperatur)', detail: coverlineDetail },
      mucusPeak: { met: false, label: 'Schleimhöhepunkt', detail: 'Kein Schleimhöhepunkt (S+ oder S) im Zyklus gefunden.' }
    }
  };

  function mucusPeakQuality(m) {
    var e = entries[m.peakDate];
    return ((e && e.mucus) || 4) - 1;
  }

  // ── Alle Temperaturmessungen des Zyklus sammeln ──
  var dates = getCycleDates(cycle, entries);
  var allTemps = dates.map(function(d) {
    var e = entries[d];
    if (!e || !e.temperature || e.tempExclude) return null;
    return { date: d, temp: roundTemp(parseFloat(e.temperature)), cycleDay: daysBetween(cycle.start, d) + 1 };
  }).filter(Boolean);

  if (allTemps.length < 7) return {
    found: false, temp: tempAnalysis, mucus: mucus,
    criteria: {
      coverlineFound: { met: true, label: 'Coverlinie (Temperatur)', detail: coverlineDetail },
      mucusPeak: { met: true, label: 'Schleimhöhepunkt', detail: 'Schleimhöhepunkt gefunden: ' + MUCUS[mucusPeakQuality(mucus)].short + ' an Tag ' + mucus.peakCycleDay + '.' },
      enoughTemps: { met: false, label: 'Temperaturwerte', detail: 'Nur ' + allTemps.length + ' Temperaturwerte vorhanden (mindestens 7 benötigt).' }
    }
  };

  // ── 3. 1. umrandete Messung: erste Messung > Coverlinie, nach Schleimhöhepunkt ──
  var firstUmrandet = null;
  var firstUmrandetIdx = -1;
  for (var i = 0; i < allTemps.length; i++) {
    if (allTemps[i].date > mucus.peakDate && allTemps[i].temp > coverline) {
      firstUmrandet = allTemps[i];
      firstUmrandetIdx = i;
      break;
    }
  }

  if (!firstUmrandet) {
    return {
      found: false, temp: tempAnalysis, mucus: mucus,
      criteria: {
        coverlineFound: { met: true, label: 'Coverlinie (Temperatur)', detail: coverlineDetail },
        mucusPeak: { met: true, label: 'Schleimhöhepunkt', detail: 'Schleimhöhepunkt gefunden: ' + MUCUS[mucusPeakQuality(mucus)].short + ' an Tag ' + mucus.peakCycleDay + '.' },
        enoughTemps: { met: true, label: 'Temperaturwerte', detail: allTemps.length + ' Temperaturwerte vorhanden.' },
        threeEncircled: { met: false, label: 'Umrandete Messungen nach Schleimhöhepunkt', detail: 'Keine Messung über der Coverlinie nach dem Schleimhöhepunkt gefunden.' }
      }
    };
  }

  // ── 4. 2. und 3. umrandete Messung suchen (max. 1 Ausnahme) ──
  var umrandetDays = [firstUmrandet];
  var exceptionUsed = false;

  for (var j = firstUmrandetIdx + 1; j < allTemps.length; j++) {
    var t = allTemps[j];
    // Muss nach dem Schleimhöhepunkt liegen
    if (t.date <= mucus.peakDate) continue;

    if (t.temp > coverline) {
      umrandetDays.push(t);
      if (umrandetDays.length >= 4) break; // Bis zu 4 sammeln für 0,2°C-Regel
    } else if (!exceptionUsed) {
      // Maximal eine Messung auf/unter der Coverlinie als Ausnahme überspringen
      exceptionUsed = true;
    } else {
      // Zweite Ausnahme – keine weiteren umrandeten Messungen möglich
      break;
    }
  }

  function formatTemp(val) { return val.toFixed(2).replace('.', ','); }

  // ── 5. 0,2 °C-Regel prüfen ──
  var neededUmrandet = 3;
  var thresholdMet = false;
  var thresholdDetail = '';

  if (umrandetDays.length >= 3) {
    thresholdMet = Math.round(umrandetDays[2].temp * 20) >= Math.round((coverline + 0.2) * 20);
    if (thresholdMet) {
      thresholdDetail = 'Die 3. umrandete Messung (' + formatTemp(umrandetDays[2].temp) + '°C) liegt ≥ ' + formatTemp(coverline + 0.2) + '°C (Coverlinie + 0,2). ✓';
    } else {
      neededUmrandet = 4;
      thresholdDetail = 'Die 3. umrandete Messung (' + formatTemp(umrandetDays[2].temp) + '°C) liegt nicht mindestens 0,2°C über der Coverlinie (' + formatTemp(coverline) + ' + 0,2 = ' + formatTemp(coverline + 0.2) + '°C). Deshalb ist eine 4. umrandete Messung erforderlich.';
    }
  }

  if (umrandetDays.length < neededUmrandet) {
    var umrInfo = umrandetDays.map(function(t) { return 'Tag ' + t.cycleDay + ' (' + formatTemp(t.temp) + '°C)'; }).join(', ');
    return {
      found: false, temp: tempAnalysis, mucus: mucus,
      criteria: {
        coverlineFound: { met: true, label: 'Coverlinie (Temperatur)', detail: coverlineDetail },
        mucusPeak: { met: true, label: 'Schleimhöhepunkt', detail: 'Schleimhöhepunkt gefunden: ' + MUCUS[mucusPeakQuality(mucus)].short + ' an Tag ' + mucus.peakCycleDay + '.' },
        enoughTemps: { met: true, label: 'Temperaturwerte', detail: allTemps.length + ' Temperaturwerte vorhanden.' },
        threeEncircled: { met: false, label: 'Umrandete Messungen nach Schleimhöhepunkt', detail: 'Nur ' + umrandetDays.length + ' umrandete Messung(en) nach dem Schleimhöhepunkt: ' + (umrInfo || 'keine') + '. Benötigt: ' + neededUmrandet + '.' + (neededUmrandet === 4 ? ' ' + thresholdDetail : '') }
      }
    };
  }

  // ── Unfruchtbar ab Abend (20:00) des benötigten umrandeten Tages ──
  var lastRequired = umrandetDays[neededUmrandet - 1];
  var infertileDate = lastRequired.date;

  var tempResult = {
    confirmed: true,
    coverline: coverline,
    fhmCycleDay: tempAnalysis.fhmCycleDay,
    fhmDate: tempAnalysis.fhmDate,
    shiftDay: lastRequired.cycleDay,
    confirmDate: lastRequired.date,
    umrandetDays: umrandetDays
  };

  var umrInfoAll = umrandetDays.map(function(t) { return 'Tag ' + t.cycleDay + ': ' + formatTemp(t.temp) + '°C'; }).join(', ');

  var criteria = {
    coverlineFound: { met: true, label: 'Coverlinie (Temperatur)', detail: coverlineDetail },
    mucusPeak: { met: true, label: 'Schleimhöhepunkt', detail: 'Schleimhöhepunkt gefunden: ' + MUCUS[mucusPeakQuality(mucus)].short + ' an Tag ' + mucus.peakCycleDay + '.' },
    enoughTemps: { met: true, label: 'Temperaturwerte', detail: allTemps.length + ' Temperaturwerte vorhanden.' },
    threeEncircled: { met: true, label: 'Umrandete Messungen nach Schleimhöhepunkt', detail: umrandetDays.length + ' umrandete Messung(en) gefunden: ' + umrInfoAll + '.' + (exceptionUsed ? ' (1 Ausnahme: Messung auf/unter der Coverlinie übersprungen)' : '') },
    thirdAboveThreshold: { met: thresholdMet, label: '3. Messung ≥ Coverlinie + 0,2°C', detail: thresholdDetail },
    result: { label: 'Ergebnis', detail: 'Unfruchtbar ab Abend (20:00) von Tag ' + lastRequired.cycleDay + ' (' + infertileDate + ').' + (neededUmrandet === 4 ? ' 4. umrandete Messung benötigt, da 3. Messung < Coverlinie + 0,2°C.' : '') }
  };

  return {
    found: true, temp: tempResult, mucus: mucus, criteria: criteria,
    umrandetDate: umrandetDays[0].date,
    umrandetCycleDay: umrandetDays[0].cycleDay,
    infertileFrom: infertileDate
  };
}

// ═════════════════════════════════════════════════════════════
// VOLLSTÄNDIGE ZYKLUSANALYSE
// ═════════════════════════════════════════════════════════════

function fullAnalysis(entries, excludedCycles, manualCoverline, manualCoverlineEnabled) {
  var cycles = detectCycles(entries);
  var exSet = excludedCycles || [];
  var manCov = manualCoverline || {};
  var manCovEnabled = manualCoverlineEnabled || {};
  var analyzed = cycles.map(function(c) {
    var mc = manCovEnabled[c.start] && manCov[c.start] ? manCov[c.start] : undefined;
    var a = analyzeUmrandeterTag(c, entries, mc);
    a.start = c.start;
    a.end = c.end;
    a.length = c.length;
    a.ongoing = c.ongoing;
    a.excluded = exSet.indexOf(c.start) !== -1;
    return a;
  });
  return analyzed;
}

// ═════════════════════════════════════════════════════════════
// FRUCHTBARKEITSBERECHNUNG
// ═════════════════════════════════════════════════════════════
//
// computeFertility() ordnet jedem Tag des aktuellen Zyklus
// einen Fruchtbarkeitsstatus zu: "infertile" oder "fertile".
//
// Alle Tage gelten grundsätzlich als fruchtbar, bis das
// Gegenteil durch die Auswertung bewiesen ist.
//
// Die Berechnung hat zwei Komponenten:
//
// ① ENDE DER FRUCHTBAREN PHASE (endFertileDate)
// ─────────────────────────────────────────────
//   Basierend auf der aktuellen Zyklusanalyse:
//     • 3 umrandete Messungen erreicht → endFertileDate = infertileFrom
//     • Nur Schleimhöhepunkt vorhanden → endFertileDate = Peak + 3 Tage
//     • Nichts vorhanden → endFertileDate = null (kein Ende bekannt)
//
// ② SICHERE TAGE AM ZYKLUSANFANG (safeDays)
// ──────────────────────────────────────────
//   Nur bei ausreichender Datenbasis (≥12 Zyklen).
//
//   a) sehrSicherBis – basierend auf Zykluslängen:
//      ≥12 Zyklen: kürzester Zyklus − 20 Tage
//
//   b) sicherBis – basierend auf frühestem Eisprung in der Historie (Döring):
//      ≥12 ausgewertete Zyklen: frühester umrandeterTag − 8 Tage
//
//   safeDays = Math.max(sehrSicherBis, sicherBis)
//
// ③ TAG-FÜR-TAG-KLASSIFIZIERUNG
// ──────────────────────────────
//   Alle Tage gelten grundsätzlich als fruchtbar.
//
//   Ausnahmen ("infertile"):
//     • d >= endFertileDate → unfruchtbar (nach bestätigtem Eisprung)
//     • cd <= safeDays → unfruchtbar (sichere Tage am Zyklusanfang)
//
// ═════════════════════════════════════════════════════════════
// UNFRUCHTBARE ZEIT AM ZYKLUSBEGINN
// ═════════════════════════════════════════════════════════════
//
// Bestimmt die Anzahl unfruchtbarer Tage zu Beginn des aktuellen
// Zyklus nach den NFP-Regeln.
//
// Schritt 1: Fortgeschrittene vs. Anfängerin
//   ≥ 12 ausgewertete Zyklen → Fortgeschrittene
//   < 12 ausgewertete Zyklen → Anfängerin
//
// Für Anfängerin:
//   • 6-Tage-Regel: ≥ 12 Kalenderaufzeichnungen, alle ≥ 26 Tage
//     → erste 6 Tage unfruchtbar (wenn keine Fruchtbarkeitszeichen)
//   • Rechenregel: ≥ 12 Kalenderaufzeichnungen, nicht alle ≥ 26 Tage
//     → kürzester Zyklus − 20 Tage unfruchtbar
//   • < 12 Kalenderaufzeichnungen → keine unfruchtbare Zeit
//
// Für Fortgeschrittene:
//   • Feinbeobachtung "f": Tage vor dem ersten Auftreten von "f"
//     (fließend) gelten als unfruchtbar
//   • Früheste 1. höhere Messung ≥ 14. Tag → 7 Tage zurück
//   • Früheste 1. höhere Messung ≤ 13. Tag → 6 Tage zurück
//   • Alle Tage davor unfruchtbar (wenn keine Fruchtbarkeitszeichen)
//
// Fruchtbarkeitszeichen S (4) oder S+ (5) schliessen unfruchtbare
// Tage am Zyklusbeginn immer aus. "f" (3) erlaubt die Feinbeobachtung.
//
function calculateBeginningInfertility(currentCycle, allAnalyzed, entries) {
  var dates = getCycleDates(currentCycle, entries);
  var today = fmt(new Date());

  var allCompleted = allAnalyzed.filter(function(c) { return c.length && !c.excluded; });
  var evaluatedCycles = allCompleted.filter(function(c) { return c.found; });
  var isAdvanced = evaluatedCycles.length >= 12;

  // ── Phase 1: Tentative safeDays from history (without current-cycle mucus) ──
  var tentativeSafeDays = 0;
  var rule = '';
  var meta = {};

  if (!isAdvanced) {
    if (allCompleted.length < 12) {
      return { safeDays: 0, isAdvanced: false, rule: 'no_data', totalCycles: allCompleted.length };
    }

    var allAtLeast26 = true;
    for (var i = 0; i < allCompleted.length; i++) {
      if (allCompleted[i].length < 26) { allAtLeast26 = false; break; }
    }

    if (allAtLeast26) {
      tentativeSafeDays = 6;
      rule = 'six_day';
    } else {
      var lengths = allCompleted.map(function(c) { return c.length; });
      var shortest = Math.min.apply(null, lengths);
      tentativeSafeDays = Math.max(0, shortest - 20);
      rule = 'calculation';
      meta.shortestCycle = shortest;
    }
  } else {
    var fhmDays = [];
    for (var j = 0; j < evaluatedCycles.length; j++) {
      var fhm = evaluatedCycles[j].temp && evaluatedCycles[j].temp.fhmCycleDay;
      if (fhm && fhm > 0) fhmDays.push(fhm);
    }

    if (fhmDays.length === 0) {
      return { safeDays: 0, isAdvanced: true, rule: 'no_fhm' };
    }

    var earliestFHM = Math.min.apply(null, fhmDays);

    if (earliestFHM >= 14) {
      tentativeSafeDays = Math.max(0, earliestFHM - 7);
      rule = 'advanced_7';
    } else {
      tentativeSafeDays = Math.max(0, earliestFHM - 6);
      rule = 'advanced_6';
    }
    meta.earliestFHM = earliestFHM;
  }

  // ── Phase 2: Check mucus ONLY within the first tentativeSafeDays days ──
  var firstFDate = null;
  var firstFCycleDay = 0;
  var overrideRule = '';
  var overrideDay = 0;

  for (var di = 0; di < dates.length; di++) {
    var d = dates[di];
    if (d > today) break;
    var cd = daysBetween(currentCycle.start, d) + 1;
    if (cd > tentativeSafeDays) break;

    var e = entries[d];
    if (!e || !e.mucus || e.mucusExclude) continue;

    if (e.mucus >= 4) {
      overrideRule = 'fertility_signs';
      overrideDay = cd;
      tentativeSafeDays = cd - 1;
      break;
    }

    if (e.mucus === 3 && !firstFDate) {
      firstFDate = d;
      firstFCycleDay = cd;
    }
  }

  // For advanced: if f found in the window, fine-f observation applies (days before first f are infertile)
  // but only if S/S+ didn't already shrink the window further
  if (isAdvanced && firstFDate && overrideRule !== 'fertility_signs') {
    rule = 'fine_f';
    meta.firstFDay = firstFCycleDay;
    tentativeSafeDays = Math.min(tentativeSafeDays, Math.max(0, firstFCycleDay - 1));
  }

  // For beginner: if f found in the window, it's a fertility sign
  if (!isAdvanced && firstFDate) {
    overrideRule = 'fertility_signs';
    overrideDay = firstFCycleDay;
    tentativeSafeDays = Math.min(tentativeSafeDays, firstFCycleDay - 1);
  }

  if (overrideRule) {
    rule = overrideRule;
    meta.overrideDay = overrideDay;
  }

  var result = Object.assign({ safeDays: tentativeSafeDays, isAdvanced: isAdvanced, rule: rule }, meta);
  return result;
}

function computeFertility(currentCycle, allAnalyzed, entries) {
  var today = fmt(new Date());
  var dates = getCycleDates(currentCycle, entries);
  var result = {};

  // ── ① Ende der fruchtbaren Phase im aktuellen Zyklus ──
  var thisAnalysis = null;
  for (var ai = 0; ai < allAnalyzed.length; ai++) {
    if (allAnalyzed[ai].start === currentCycle.start) { thisAnalysis = allAnalyzed[ai]; break; }
  }
  var endFertileDate = null;
  if (thisAnalysis && thisAnalysis.found) {
    endFertileDate = thisAnalysis.infertileFrom;
  } else if (thisAnalysis && thisAnalysis.mucus && thisAnalysis.mucus.found) {
    endFertileDate = thisAnalysis.mucus.plus3Date;
  }

  // ── ② Sichere Tage am Zyklusanfang aus der Historie ──
  var allCompleted = allAnalyzed.filter(function(c) { return c.length && !c.excluded; });
  var totalRecentCycles = allCompleted.length;
  var evaluatedRecent = allCompleted.filter(function(c) { return c.found; });

  var beginInfertility = calculateBeginningInfertility(currentCycle, allAnalyzed, entries);
  var safeDays = beginInfertility.safeDays;

  var sehrSicherBis = 0;
  var sicherBis = 0;
  if (beginInfertility.isAdvanced) {
    sicherBis = safeDays;
  } else {
    sehrSicherBis = safeDays;
  }

  // ── ③ Tag-für-Tag-Klassifizierung ──
  for (var di = 0; di < dates.length; di++) {
    var d = dates[di];
    if (d > today && currentCycle.ongoing) break;
    var cd = daysBetween(currentCycle.start, d) + 1;

    if (endFertileDate && d > endFertileDate) {
      result[d] = "infertile";
    } else if (cd <= safeDays) {
      result[d] = "infertile";
    } else {
      // Alle anderen Tage gelten als fruchtbar
      result[d] = "fertile";
    }
  }

  return { result: result, sehrSicherBis: sehrSicherBis, sicherBis: sicherBis, safeDays: safeDays, endFertileDate: endFertileDate, totalRecentCycles: totalRecentCycles, evaluatedRecentCount: evaluatedRecent.length, beginInfertility: beginInfertility };
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
//      nächste Menstruation = aktuelles infertileFrom + Ø-Dauer
//
function predictNextMenstruation(currentCycle, allAnalyzed, entries) {
  var thisAnalysis = null;
  for (var ai = 0; ai < allAnalyzed.length; ai++) {
    if (allAnalyzed[ai].start === currentCycle.start) { thisAnalysis = allAnalyzed[ai]; break; }
  }
  if (!thisAnalysis || !thisAnalysis.found) return { canPredict: false };

  var infertileFrom = thisAnalysis.infertileFrom;
  var completed = allAnalyzed.filter(function(c) { return c.length && c.found && !c.excluded; });

  if (!completed.length) return { canPredict: false };

  var totalLength = completed.reduce(function(sum, c) { return sum + c.length; }, 0);
  var avgCycleLength = Math.round(totalLength / completed.length);
  var nextFromLength = addDays(currentCycle.start, avgCycleLength);

  var infPhases = completed.map(function(c) {
    var infFromCD = daysBetween(c.start, c.infertileFrom) + 1;
    return c.length - infFromCD + 1;
  });
  var totalInf = infPhases.reduce(function(sum, p) { return sum + p; }, 0);
  var avgInfertilePhase = Math.round(totalInf / infPhases.length);
  var nextFromInfertile = addDays(infertileFrom, avgInfertilePhase);

  return {
    canPredict: true,
    avgCycleLength: avgCycleLength,
    nextFromLength: nextFromLength,
    avgInfertilePhase: avgInfertilePhase,
    nextFromInfertile: nextFromInfertile,
    completedCount: completed.length
  };
}
