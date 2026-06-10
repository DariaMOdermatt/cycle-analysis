"use strict";

// ══════════════════════════════════════════════
// UNIT TESTS — engine.js
// ══════════════════════════════════════════════

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  fmt, parseLocal, daysBetween, addDays, roundTemp,
  getDaysInMonth, getFirstDayOfWeek, MUCUS, MONTHS_DE, DAYS_DE,
  detectCycles, getCycleDates,
  analyzeTemp, analyzeMucus, analyzeUmrandeterTag,
  fullAnalysis, computeFertility, predictNextMenstruation,
  calculateBeginningInfertility,
} = require("./test-helpers.js");

// ── Hilfsfunktion: entries-Objekt bauen ──
// Temperatur als String MIT PUNKT (wie im echten CSV: 36.6)
function makeEntries(startDate, days) {
  const entries = {};
  let d = startDate;
  for (const spec of days) {
    const date = spec.date || d;
    entries[date] = {
      bleeding: spec.bleeding ?? 0,
      spotting: spec.spotting || false,
      temperature: spec.temperature ?? "",
      tempExclude: spec.tempExclude || false,
      mucus: spec.mucus ?? 0,
      mucusExclude: spec.mucusExclude || false,
    };
    d = addDays(d, 1);
  }
  return entries;
}

// shorthand: [bleeding, tempString, mucus, tempExclude?, mucusExclude?]
function e(specs) {
  return makeEntries("2025-06-01", specs.map(s => {
    if (Array.isArray(s)) {
      return {
        bleeding: s[0],
        temperature: s[1] != null ? String(s[1]) : "",
        mucus: s[2] ?? 0,
        tempExclude: s[3] || false,
        mucusExclude: s[4] || false,
      };
    }
    return s;
  }));
}

// ── 1. Datumshilfsfunktionen ──
describe("fmt", () => {
  it("formatiert ein Date-Objekt als YYYY-MM-DD", () => {
    assert.strictEqual(fmt(new Date(2025, 0, 1)), "2025-01-01");
    assert.strictEqual(fmt(new Date(2025, 5, 7)), "2025-06-07");
    assert.strictEqual(fmt(new Date(2025, 11, 31)), "2025-12-31");
  });
});

describe("parseLocal", () => {
  it("parsed YYYY-MM-DD zu einem lokalen Date", () => {
    const d = parseLocal("2025-06-07");
    assert.strictEqual(d.getFullYear(), 2025);
    assert.strictEqual(d.getMonth(), 5);
    assert.strictEqual(d.getDate(), 7);
  });
});

describe("daysBetween", () => {
  it("zählt Tage zwischen zwei Datums-Strings", () => {
    assert.strictEqual(daysBetween("2025-06-01", "2025-06-01"), 0);
    assert.strictEqual(daysBetween("2025-06-01", "2025-06-02"), 1);
    assert.strictEqual(daysBetween("2025-06-01", "2025-06-07"), 6);
    assert.strictEqual(daysBetween("2025-12-25", "2026-01-01"), 7);
  });
});

describe("addDays", () => {
  it("addiert Tage zu einem Datums-String", () => {
    assert.strictEqual(addDays("2025-06-01", 0), "2025-06-01");
    assert.strictEqual(addDays("2025-06-01", 1), "2025-06-02");
    assert.strictEqual(addDays("2025-06-01", 30), "2025-07-01");
    assert.strictEqual(addDays("2025-12-31", 1), "2026-01-01");
    assert.strictEqual(addDays("2025-06-01", -1), "2025-05-31");
  });
});

// ── 2. Temperatur-Rundung ──
describe("roundTemp", () => {
  it("rundet auf 0.05°C Schritte", () => {
    assert.strictEqual(roundTemp(36.50), 36.50);
    assert.strictEqual(roundTemp(36.51), 36.50);
    assert.strictEqual(roundTemp(36.52), 36.50);
    assert.strictEqual(roundTemp(36.53), 36.55);
    assert.strictEqual(roundTemp(36.55), 36.55);
    assert.strictEqual(roundTemp(36.57), 36.55);
    assert.strictEqual(roundTemp(36.58), 36.60);
    assert.strictEqual(roundTemp(36.60), 36.60);
    assert.strictEqual(roundTemp(36.74), 36.75);
  });
});

// ── 3. Kalender-Hilfsfunktionen ──
describe("getDaysInMonth", () => {
  it("Januar 2025 hat 31 Tage", () => {
    assert.strictEqual(getDaysInMonth(2025, 0), 31);
  });
  it("Februar 2025 hat 28 Tage", () => {
    assert.strictEqual(getDaysInMonth(2025, 1), 28);
  });
  it("Februar 2024 hat 29 Tage", () => {
    assert.strictEqual(getDaysInMonth(2024, 1), 29);
  });
  it("April hat 30 Tage", () => {
    assert.strictEqual(getDaysInMonth(2025, 3), 30);
  });
});

describe("getFirstDayOfWeek", () => {
  it("1. Juni 2025: So → 6 (Mo=0)", () => {
    assert.strictEqual(getFirstDayOfWeek(2025, 5), 6);
  });
  it("1. Januar 2025: Mi → 2", () => {
    assert.strictEqual(getFirstDayOfWeek(2025, 0), 2);
  });
  it("1. Mai 2025: Do → 3", () => {
    assert.strictEqual(getFirstDayOfWeek(2025, 4), 3);
  });
});

// ── 4. MUCUS ──
describe("MUCUS", () => {
  it("5 Eintraege (mucus 1–5)", () => {
    assert.strictEqual(MUCUS.length, 5);
    assert.strictEqual(MUCUS[0].short, "t");
    assert.strictEqual(MUCUS[4].short, "S+");
  });
});

// ── 5. Zykluserkennung ──
describe("detectCycles", () => {
  it("leeres entries → leeres Array", () => {
    assert.deepStrictEqual(detectCycles({}), []);
  });

  it("zwei Blutungen → zwei abgeschlossene Zyklen", () => {
    // 3 Blutungen → 3 Zyklen (nur dann haben alle ein Ende)
    const entries = e([
      [1], [1], [0], [0], [0],
      [1], [1], [0], [0], [0],
      [1], [1],
    ]);
    const cycles = detectCycles(entries);
    assert.strictEqual(cycles.length, 3);
    assert.strictEqual(cycles[0].start, "2025-06-01");
    assert.strictEqual(cycles[0].end, "2025-06-05");
    assert.strictEqual(cycles[0].length, 5);
    assert.strictEqual(cycles[0].ongoing, false);
    assert.strictEqual(cycles[1].start, "2025-06-06");
    assert.strictEqual(cycles[1].end, "2025-06-10");
    assert.strictEqual(cycles[1].length, 5);
    assert.strictEqual(cycles[1].ongoing, false);
    assert.strictEqual(cycles[2].start, "2025-06-11");
    assert.strictEqual(cycles[2].ongoing, true);
  });

  it("letzter Zyklus ohne Folgeblutung → ongoing", () => {
    const entries = e([
      [1], [0], [0], [0], [0],
      [1], [0], [0],
    ]);
    const cycles = detectCycles(entries);
    assert.strictEqual(cycles.length, 2);
    assert.strictEqual(cycles[0].ongoing, false);
    assert.strictEqual(cycles[1].ongoing, true);
    assert.strictEqual(cycles[1].end, null);
    assert.strictEqual(cycles[1].length, null);
  });

  it("einzelner laufender Zyklus", () => {
    const entries = e([
      [1], [0], [0], [0],
    ]);
    const cycles = detectCycles(entries);
    assert.strictEqual(cycles.length, 1);
    assert.strictEqual(cycles[0].start, "2025-06-01");
    assert.strictEqual(cycles[0].ongoing, true);
  });

  it("Lücke >1 Tag zwischen Blutungen → neuer Zyklus", () => {
    // [1,1,1,0,0,1] → gap between day 3 and day 6 = 2 > 1 → new cycle
    const entries = e([
      [1], [1], [1], [0], [0], [1],
    ]);
    const cycles = detectCycles(entries);
    assert.strictEqual(cycles.length, 2);
    assert.strictEqual(cycles[0].start, "2025-06-01");
    assert.strictEqual(cycles[1].start, "2025-06-06");
  });

  it("ein blutungsfreier Tag beendet die Blutung → naechste Blutung ist neuer Zyklus", () => {
    // Da inBleeding=false am Tag ohne Blutung, startet naechste Blutung neu
    const entries = e([
      [1], [0], [1],
    ]);
    const cycles = detectCycles(entries);
    assert.strictEqual(cycles.length, 2);
    assert.strictEqual(cycles[0].start, "2025-06-01");
    assert.strictEqual(cycles[0].end, "2025-06-02");
  });

  it("direkte Folgeblutung (kein Tag dazwischen) → kein neuer Zyklus", () => {
    const entries = e([
      [1], [1], [1], [0],
    ]);
    const cycles = detectCycles(entries);
    assert.strictEqual(cycles.length, 1);
  });

  it("Schmierblutung (spotting) loest keinen neuen Zyklus aus", () => {
    const entries = e([
      { bleeding: 1 }, { bleeding: 0 }, { bleeding: 0 },
      { bleeding: 1, spotting: true }, { bleeding: 1, spotting: true },
      { bleeding: 0 }, { bleeding: 0 },
      { bleeding: 1 },
    ]);
    const cycles = detectCycles(entries);
    assert.strictEqual(cycles.length, 2);
    assert.strictEqual(cycles[0].start, "2025-06-01");
    assert.strictEqual(cycles[1].start, "2025-06-08");
  });

  it("Schmierblutung beendet keinen laufenden Zyklus", () => {
    const entries = e([
      { bleeding: 1 }, { bleeding: 0 }, { bleeding: 0 },
      { bleeding: 2, spotting: true },
      { bleeding: 0 }, { bleeding: 1 },
    ]);
    const cycles = detectCycles(entries);
    assert.strictEqual(cycles.length, 2);
    assert.strictEqual(cycles[0].start, "2025-06-01");
    assert.strictEqual(cycles[0].end, "2025-06-05");
    assert.strictEqual(cycles[1].start, "2025-06-06");
  });
});

// ── 6. getCycleDates ──
describe("getCycleDates", () => {
  it("alle Tage eines abgeschlossenen Zyklus", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.55", 2],
      [1, "36.60", 1], [0, "36.58", 1],
    ]);
    const cycles = detectCycles(entries);
    const dates = getCycleDates(cycles[0], entries);
    assert.deepStrictEqual(dates, ["2025-06-01", "2025-06-02", "2025-06-03"]);
  });
});

// ── 7. Temperaturanalyse (7-aufeinanderfolgende-Tage-Regel) ──
describe("analyzeTemp", () => {
  it("<7 Werte → nicht bestätigt", () => {
    const entries = {};
    for (let i = 0; i < 5; i++) {
      const date = addDays("2025-07-01", i);
      entries[date] = { bleeding: i === 0 ? 1 : 0, temperature: "36.50", tempExclude: false, mucus: 1 };
    }
    const cycle = { start: "2025-07-01", end: "2025-07-05", length: 5, ongoing: false };
    assert.strictEqual(analyzeTemp(cycle, entries).confirmed, false);
  });

  it("7-Tage-Regel: 7. Wert > Maximum der 6 vorangegangenen mit mindestens 3 aufeinanderfolgenden Hochwerten", () => {
    // Days 1-6: low temps (~36.50), Day 7-9: high temps → sustained shift
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.80", 3], [0, "36.82", 3], [0, "36.85", 3],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-09", length: 9, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    assert.strictEqual(result.confirmed, true);
    assert.strictEqual(result.coverline, 36.50);
    assert.strictEqual(result.fhmCycleDay, 7);
    assert.strictEqual(result.fhmDate, "2025-06-07");
  });

  it("7. Wert nicht über Maximum → nicht bestätigt", () => {
    // 6 lows max = 36.52, 7th = 36.52 (not above) → false
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.52", 3],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-07", length: 7, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    assert.strictEqual(result.confirmed, false);
  });

  it("maximal 1 fehlende Messung in den 6 vorangegangenen erlaubt (aber nicht am ersten Tag)", () => {
    // Day 4 has no temp (missing in the middle, not at start)
    // Day 7 cannot be FHM (only 5 pre-temps, cannot expand to day 0)
    // Day 8: pre-window expanded → coverline=36.80, candidate 36.80 (rounded from 36.82) not above
    // Day 9: pre-window expanded → coverline=36.80, candidate 36.85 > 36.80 → FOUND
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "", 2], // missing temp on day 4 (middle, not at start)
      [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.80", 3], [0, "36.82", 3], [0, "36.85", 3],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-09", length: 9, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    assert.strictEqual(result.confirmed, true);
    assert.strictEqual(result.coverline, 36.80);
    assert.strictEqual(result.fhmCycleDay, 9);
    assert.strictEqual(result.fhmDate, "2025-06-09");
  });

  it("fehlende Messung am ersten der 6 vorangegangenen Tage → nicht bestätigt", () => {
    // Gap at the very first day of the 6-day pre-window is not allowed
    // Days 1-5: no temps, Day 6: no temp, Days 7-12: temps, Day 13: temp below coverline
    const entries = e([
      [1, "", 1], [0, "", 1], [0, "", 1],
      [0, "", 2], [0, "", 2],
      [0, "", 2], // day 6 missing → gap at first position for candidate day 12
      [0, "36.50", 2], [0, "36.50", 1], [0, "36.50", 1],
      [0, "36.50", 2], [0, "36.50", 2], [0, "36.80", 3], // day 12 candidate blocked
      [0, "36.60", 2], // day 13: pre-window days 7-12, coverline=36.80, 36.60 not above
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-13", length: 13, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    assert.strictEqual(result.confirmed, false);
  });

  it("mehr als 1 fehlende Messung → nicht bestätigt", () => {
    // Day 4 and Day 6 missing → 2 missing → false
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "", 2], // missing
      [0, "36.49", 2],
      [0, "", 2], // missing
      [0, "36.80", 3],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-07", length: 7, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    assert.strictEqual(result.confirmed, false);
  });

  it("ausgeschlossene Temperaturen werden ignoriert", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "37.50", 3, true], // Fieber – ausgeschlossen
      [0, "36.80", 3], [0, "36.82", 3], [0, "36.85", 3],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-10", length: 10, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    assert.strictEqual(result.confirmed, true);
    assert.strictEqual(result.fhmDate, "2025-06-08");
  });

  it("findet den ersten Anstieg (erster Tag mit Wert > max der 6 vorangegangenen)", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.80", 3], [0, "36.82", 3], [0, "36.85", 3],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-09", length: 9, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    assert.strictEqual(result.confirmed, true);
    assert.strictEqual(result.fhmCycleDay, 7);
    assert.strictEqual(result.fhmDate, "2025-06-07");
  });
});

// ── 8. Schleimanalyse ──
describe("analyzeMucus", () => {
  it("kein S+ oder S → kein Peak", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 2], [0, "36.50", 3],
      [0, "36.50", 2], [0, "36.50", 1],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-05", length: 5, ongoing: false };
    assert.strictEqual(analyzeMucus(cycle, entries).found, false);
  });

  it("S+ Peak: letzter S+ Tag vor Abfall", () => {
    const entries = e([
      [1, "36.50", 3],
      [0, "36.50", 4],
      [0, "36.50", 5], // S+
      [0, "36.50", 5], // S+ ← Peak (letzter)
      [0, "36.50", 2], // Abfall
      [0, "36.50", 1],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-06", length: 6, ongoing: false };
    const result = analyzeMucus(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.peakDate, "2025-06-04");
    assert.strictEqual(result.peakCycleDay, 4);
    assert.strictEqual(result.plus3Date, "2025-06-07");
  });

  it("S Peak (kein S+): letzter S Tag vor Abfall", () => {
    const entries = e([
      [1, "36.50", 2],
      [0, "36.50", 3],
      [0, "36.50", 4], // S ← Peak
      [0, "36.50", 2], // Abfall
      [0, "36.50", 1],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-05", length: 5, ongoing: false };
    const result = analyzeMucus(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.peakDate, "2025-06-03");
  });

  it("S+ hat Vorrang vor S", () => {
    const entries = e([
      [1, "36.50", 4], // S
      [0, "36.50", 5], // S+ ← Peak (höhere Priorität)
      [0, "36.50", 2], // Abfall
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-03", length: 3, ongoing: false };
    const result = analyzeMucus(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.peakDate, "2025-06-02");
  });

  it("S+ am Zyklusende (kein Abfall danach) → Peak trotzdem erkannt", () => {
    const entries = e([
      [1, "36.50", 3],
      [0, "36.50", 5],
      [0, "36.50", 5],
      [0, "36.50", 5], // letzter Tag, kein nächster
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-04", length: 4, ongoing: false };
    const result = analyzeMucus(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.peakDate, "2025-06-04");
  });

  it("ausgeschlossene Tage werden übersprungen", () => {
    const entries = e([
      [1, "36.50", 5],
      [0, "36.50", 5],
      [0, "36.50", 2, false, true], // excluded
      [0, "36.50", 1],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-04", length: 4, ongoing: false };
    const result = analyzeMucus(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.peakDate, "2025-06-02");
  });

  it("mehrere S+ Phasen: letzte S+ Phase gewinnt", () => {
    const entries = e([
      [1, "36.50", 5], [0, "36.50", 5],
      [0, "36.50", 2], // Abfall
      [0, "36.50", 3],
      [0, "36.50", 5], // zweite S+ ← Peak
      [0, "36.50", 2], // Abfall
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-06", length: 6, ongoing: false };
    const result = analyzeMucus(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.peakDate, "2025-06-05");
  });
});

// ── 9. analyzeUmrandeterTag ──
describe("analyzeUmrandeterTag", () => {
  it("kein Schleimhöhepunkt → found: false", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.80", 2],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-07", length: 7, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.mucus.found, false);
  });

  it("zu wenig Temperaturwerte für Coverline → nicht auswertbar", () => {
    const entries = e([
      [1, "36.50", 4], [0, "36.52", 2], [0, "36.53", 2],
      [0, "36.50", 2], [0, "36.51", 2],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-05", length: 5, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.criteria.coverlineFound.met, false);
  });

  it("vollständig ausgewerteter Zyklus mit 3 umrandeten Messungen", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.50", 5], // Peak S+ (day 7)
      [0, "36.80", 2], // umrandet 1 (day 8)
      [0, "36.82", 1], // umrandet 2 (day 9)
      [0, "36.81", 1], // umrandet 3 (day 10)
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-10", length: 10, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.mucus.found, true);
    assert.strictEqual(result.temp.confirmed, true);
    // 36.52 rounds to 36.50 with 0.05°C rounding
    assert.strictEqual(result.temp.coverline, 36.50);
    assert.strictEqual(result.criteria.threeEncircled.met, true);
    // infertile from evening of 3rd umrandet day (day 10)
    assert.strictEqual(result.infertileFrom, "2025-06-10");
  });

  it("3. umrandete < coverline+0.2 → braucht 4 umrandete", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.50", 5], // Peak (day 7)
      [0, "36.53", 2], // umr 1 (day 8)
      [0, "36.54", 1], // umr 2 (day 9)
      [0, "36.55", 1], // umr 3 (day 10) — 36.55 < 36.52+0.2=36.72
      [0, "36.56", 1], // umr 4 (day 11) → reicht
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-11", length: 11, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.criteria.threeEncircled.met, true);
    assert.strictEqual(result.criteria.thirdAboveThreshold.met, false);
    // infertile from evening of 4th umrandet day (day 11)
    assert.strictEqual(result.infertileFrom, "2025-06-11");
  });

  it("nur 1 umrandete Messung nach Peak → nicht genug", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.80", 2], // high 1 (day 7)
      [0, "36.82", 2], // high 2 (day 8)
      [0, "36.85", 5], // high 3 + Peak S+ (day 9)
      [0, "36.83", 1], // umr 1 (day 10)
      [0, "36.50", 1], // nicht umr (day 11)
      [0, "36.50", 1], // nicht umr (day 12)
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-12", length: 12, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.criteria.threeEncircled.met, false);
  });

  it("Coverline wird über die 7-Tage-Regel (unabhängig vom Schleim) bestimmt", () => {
    const entries = e([
      [1, "36.80", 1], [0, "36.60", 1], [0, "36.70", 1],
      [0, "36.50", 1], [0, "36.55", 1], [0, "36.65", 1],
      [0, "36.50", 5], // Peak (day 7)
      [0, "36.90", 2], [0, "36.91", 2], [0, "36.92", 2],
      [0, "36.93", 2],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-11", length: 11, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, true);
    // 7-Tage-Regel: day 8 (36.90) > max of days 2-7 = max(36.60,36.70,36.50,36.55,36.65,36.50) = 36.70
    assert.strictEqual(result.temp.coverline, 36.70);
  });
});

// ── 10. fullAnalysis ──
describe("fullAnalysis", () => {
  it("analysiert alle erkannten Zyklen", () => {
    const entries = {};
    for (let c = 0; c < 2; c++) {
      const base = addDays("2025-06-01", c * 10);
      for (let i = 0; i < 10; i++) {
        const date = addDays(base, i);
        const cd = i + 1;
        entries[date] = {
          bleeding: i < 2 ? 1 : 0,
          temperature: cd <= 6 ? "36.50" : (cd === 7 ? "36.50" : "36.80"),
          tempExclude: false,
          mucus: cd === 7 ? 5 : (cd >= 8 ? 2 : 1),
        };
      }
    }
    const result = fullAnalysis(entries);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].mucus.found, true);
    assert.strictEqual(result[1].mucus.found, true);
  });

  it("leeres entries → leeres Array", () => {
    assert.deepStrictEqual(fullAnalysis({}), []);
  });
});

// ── 11. computeFertility ──
describe("computeFertility", () => {
  it("nicht ausgewerteter Zyklus → alle Tage fertile", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 2], [0, "36.50", 1],
    ]);
    const allAnalyzed = detectCycles(entries).map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const current = allAnalyzed[0];
    const fert = computeFertility(current, allAnalyzed, entries);
    for (const status of Object.values(fert.result)) {
      assert.strictEqual(status, "fertile");
    }
  });

  it("safeDays = 0 ohne Historie", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 2], [0, "36.50", 1],
      [0, "36.50", 2], [0, "36.50", 1], [0, "36.50", 2],
      [1, "36.50", 1],
    ]);
    const allAnalyzed = detectCycles(entries).map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const fert = computeFertility(allAnalyzed[1], allAnalyzed, entries);
    assert.strictEqual(fert.safeDays, 0);
  });

  it("endFertileDate scheidet fertile von infertile", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.50", 5], [0, "36.80", 2], [0, "36.82", 1],
      [0, "36.81", 1], [0, "36.83", 1],
    ]);
    const allAnalyzed = detectCycles(entries).map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const fert = computeFertility(allAnalyzed[0], allAnalyzed, entries);
    const endDate = fert.endFertileDate;
    assert.ok(endDate);
    for (const [d, status] of Object.entries(fert.result)) {
      if (d <= endDate) {
        assert.strictEqual(status, "fertile", `Tag ${d} sollte fertile sein`);
      } else {
        assert.strictEqual(status, "infertile", `Tag ${d} sollte infertile sein`);
      }
    }
  });
});

// ── 12. calculateBeginningInfertility ──
describe("calculateBeginningInfertility", () => {
  it("Anfängerin: < 12 Kalenderaufzeichnungen → keine unfruchtbare Zeit", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 2], [0, "36.50", 1],
      [0, "36.50", 2], [0, "36.50", 1],
    ]);
    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const result = calculateBeginningInfertility(allAnalyzed[0], allAnalyzed, entries);
    assert.strictEqual(result.safeDays, 0);
    assert.strictEqual(result.isAdvanced, false);
    assert.strictEqual(result.rule, 'no_data');
  });

  it("Anfängerin: Fruchtbarkeitszeichen (mucus = f) → keine unfruchtbare Zeit", () => {
    const entries = e([
      [1, "36.50", 3], [0, "36.50", 2], // mucus 3 = f
      [0, "36.50", 1],
    ]);
    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const result = calculateBeginningInfertility(allAnalyzed[0], allAnalyzed, entries);
    assert.strictEqual(result.safeDays, 0);
    assert.strictEqual(result.rule, 'no_data');
  });

  it("Anfängerin: Fruchtbarkeitszeichen (mucus = S) → keine unfruchtbare Zeit", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 4], // mucus 4 = S
      [0, "36.50", 1],
    ]);
    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const result = calculateBeginningInfertility(allAnalyzed[0], allAnalyzed, entries);
    assert.strictEqual(result.safeDays, 0);
    assert.strictEqual(result.rule, 'no_data');
  });

  it("Anfängerin: Fruchtbarkeitszeichen (mucus = S+) → keine unfruchtbare Zeit", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 5], // mucus 5 = S+
      [0, "36.50", 1],
    ]);
    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const result = calculateBeginningInfertility(allAnalyzed[0], allAnalyzed, entries);
    assert.strictEqual(result.safeDays, 0);
    assert.strictEqual(result.rule, 'no_data');
  });

  it("Anfängerin: ausgeschlossener Schleim wird ignoriert", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 0],
      [0, "36.50", 5, false, true], // mucusExclude = true
    ]);
    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    // Need 12 completed cycles for the calculation, but we have <12 so rule = no_data
    const result = calculateBeginningInfertility(allAnalyzed[0], allAnalyzed, entries);
    // Even though no fertility signs (excluded), not enough data → 0
    assert.strictEqual(result.safeDays, 0);
  });

  it("Anfängerin: 6-Tage-Regel (alle Zyklen ≥ 26 Tage)", () => {
    // Build 12 completed cycles, all exactly 26 days, with no fertility signs
    const entries = {};
    const base = "2025-01-01";
    for (let c = 0; c < 13; c++) {
      const start = addDays(base, c * 26);
      for (let i = 0; i < 26; i++) {
        const date = addDays(start, i);
        entries[date] = {
          bleeding: i === 0 ? 1 : 0,
          temperature: "",
          mucus: i < 3 ? 1 : 2, // dry / nothing (no fertility signs)
          mucusExclude: false,
        };
      }
    }
    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const current = allAnalyzed[allAnalyzed.length - 1];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.isAdvanced, false);
    assert.strictEqual(result.rule, 'six_day');
    assert.strictEqual(result.safeDays, 6);
  });

  it("Anfängerin: Rechenregel (nicht alle Zyklen ≥ 26 Tage)", () => {
    // Build 12 cycles: 11 x 26 days, 1 x 24 days → shortest = 24, safeDays = 24-20 = 4
    const entries = {};
    const base = "2025-01-01";
    const lengths = [];
    for (let c = 0; c < 11; c++) lengths.push(26);
    lengths.push(24);
    let offset = 0;
    for (let c = 0; c < lengths.length; c++) {
      const start = addDays(base, offset);
      for (let i = 0; i < lengths[c]; i++) {
        const date = addDays(start, i);
        entries[date] = {
          bleeding: i === 0 ? 1 : 0,
          temperature: "",
          mucus: 1,
          mucusExclude: false,
        };
      }
      offset += lengths[c];
    }
    // Add the current cycle (without end)
    const curStart = addDays(base, offset);
    for (let i = 0; i < 5; i++) {
      const date = addDays(curStart, i);
      entries[date] = {
        bleeding: i === 0 ? 1 : 0,
        temperature: "",
        mucus: i < 2 ? 1 : 2,
        mucusExclude: false,
      };
    }

    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const current = allAnalyzed[allAnalyzed.length - 1];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.isAdvanced, false);
    assert.strictEqual(result.rule, 'calculation');
    assert.strictEqual(result.shortestCycle, 24);
    assert.strictEqual(result.safeDays, 4);
  });

  it("Anfängerin: Rechenregel mit kürzerem Zyklus (shortest=25 → safeDays=5)", () => {
    const entries = {};
    const base = "2025-01-01";
    // 11 x 28 days, 1 x 25 days
    const lengths = [];
    for (let c = 0; c < 11; c++) lengths.push(28);
    lengths.push(25);
    let offset = 0;
    for (let c = 0; c < lengths.length; c++) {
      const start = addDays(base, offset);
      for (let i = 0; i < lengths[c]; i++) {
        const date = addDays(start, i);
        entries[date] = {
          bleeding: i === 0 ? 1 : 0,
          temperature: "",
          mucus: 1,
          mucusExclude: false,
        };
      }
      offset += lengths[c];
    }
    const curStart = addDays(base, offset);
    for (let i = 0; i < 3; i++) {
      const date = addDays(curStart, i);
      entries[date] = { bleeding: i === 0 ? 1 : 0, temperature: "", mucus: 1, mucusExclude: false };
    }

    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const current = allAnalyzed[allAnalyzed.length - 1];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.rule, 'calculation');
    assert.strictEqual(result.safeDays, 5);
  });

  // ── Fortgeschrittene Tests ──

  function buildEvaluatedCycles(count, baseDate, cycleLength, fhmDay, peakDay) {
    const entries = {};
    for (let c = 0; c < count; c++) {
      const start = addDays(baseDate, c * cycleLength);
      for (let i = 0; i < cycleLength - 1; i++) {
        const date = addDays(start, i);
        const cd = i + 1;
        entries[date] = {
          bleeding: i === 0 ? 1 : 0,
          temperature: cd < fhmDay ? "36.50" : "36.80",
          mucus: cd === peakDay ? 5 : (cd > peakDay ? 2 : 1),
          mucusExclude: false,
        };
      }
    }
    return entries;
  }

  function getAnalyzedCycles(entries) {
    const cycles = detectCycles(entries);
    return cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
  }

  it("Fortgeschrittene: frühester Temperaturanstieg ≥ 14 → safeDays = earliestFHM − 7", () => {
    // 12 evaluated cycles, fhm at day 17
    const entries = buildEvaluatedCycles(12, "2025-01-01", 28, 17, 11);
    // Current cycle without fertility signs
    const curStart = addDays("2025-01-01", 12 * 28);
    for (let i = 0; i < 10; i++) {
      const date = addDays(curStart, i);
      entries[date] = {
        bleeding: i === 0 ? 1 : 0,
        temperature: "36.50",
        mucus: i < 3 ? 1 : 2,
        mucusExclude: false,
      };
    }

    const allAnalyzed = getAnalyzedCycles(entries);
    const evaluated = allAnalyzed.filter(c => c.found);
    assert.ok(evaluated.length >= 12, "Need at least 12 evaluated cycles, got " + evaluated.length);

    const current = allAnalyzed.filter(c => c.ongoing)[0];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.isAdvanced, true);
    assert.strictEqual(result.rule, 'advanced_7');
    assert.strictEqual(result.earliestFHM, 17);
    assert.strictEqual(result.safeDays, 10);
  });

  it("Fortgeschrittene: frühester Temperaturanstieg ≤ 13 → safeDays = earliestFHM − 6", () => {
    // 12 evaluated cycles, fhm at day 10
    const entries = buildEvaluatedCycles(12, "2025-01-01", 26, 10, 6);
    const curStart = addDays("2025-01-01", 12 * 26);
    for (let i = 0; i < 8; i++) {
      const date = addDays(curStart, i);
      entries[date] = {
        bleeding: i === 0 ? 1 : 0,
        temperature: "36.50",
        mucus: i < 2 ? 1 : 2,
        mucusExclude: false,
      };
    }

    const allAnalyzed = getAnalyzedCycles(entries);
    const evaluated = allAnalyzed.filter(c => c.found);
    assert.ok(evaluated.length >= 12, "Need at least 12 evaluated cycles, got " + evaluated.length);

    const current = allAnalyzed.filter(c => c.ongoing)[0];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.isAdvanced, true);
    assert.strictEqual(result.rule, 'advanced_6');
    assert.strictEqual(result.earliestFHM, 10);
    assert.strictEqual(result.safeDays, 4);
  });

  it("Fortgeschrittene: S im unfruchtbaren Fenster verkürzt sicherBis", () => {
    // Build 12 evaluated cycles, earliestFHM=17 → safeDays=10, S on day 4
    const entries = buildEvaluatedCycles(12, "2025-01-01", 28, 17, 11);
    const curStart = addDays("2025-01-01", 12 * 28);
    for (let i = 0; i < 10; i++) {
      const date = addDays(curStart, i);
      entries[date] = {
        bleeding: i === 0 ? 1 : 0,
        temperature: "36.50",
        mucus: i === 3 ? 4 : 2, // S on day 4
        mucusExclude: false,
      };
    }

    const allAnalyzed = getAnalyzedCycles(entries);
    const current = allAnalyzed.filter(c => c.ongoing)[0];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.rule, 'fertility_signs');
    assert.strictEqual(result.safeDays, 3);
  });

  it("Fortgeschrittene: S ausserhalb des unfruchtbaren Fensters → safeDays unveraendert", () => {
    // earliestFHM=17 → safeDays=10, S on day 12 (outside window)
    const entries = buildEvaluatedCycles(12, "2025-01-01", 28, 17, 11);
    const curStart = addDays("2025-01-01", 12 * 28);
    for (let i = 0; i < 15; i++) {
      const date = addDays(curStart, i);
      entries[date] = {
        bleeding: i === 0 ? 1 : 0,
        temperature: "36.50",
        mucus: i === 11 ? 4 : 2, // S on day 12
        mucusExclude: false,
      };
    }

    const allAnalyzed = getAnalyzedCycles(entries);
    const current = allAnalyzed.filter(c => c.ongoing)[0];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.isAdvanced, true);
    assert.strictEqual(result.rule, 'advanced_7');
    assert.strictEqual(result.safeDays, 10);
  });

  it("Anfaengerin: S ausserhalb der 6-Tage-Regel → safeDays unveraendert", () => {
    // 12 completed cycles all ≥26 days → 6-day rule, S on day 8 (outside)
    const entries = {};
    const base = "2025-01-01";
    for (let c = 0; c < 13; c++) {
      const start = addDays(base, c * 26);
      for (let i = 0; i < 26; i++) {
        const date = addDays(start, i);
        entries[date] = {
          bleeding: i === 0 ? 1 : 0,
          temperature: "",
          mucus: 1,
          mucusExclude: false,
        };
      }
    }
    const curStart = addDays(base, 13 * 26);
    for (let i = 0; i < 12; i++) {
      const date = addDays(curStart, i);
      entries[date] = {
        bleeding: i === 0 ? 1 : 0,
        temperature: "36.50",
        mucus: i === 7 ? 4 : 2, // S on day 8
        mucusExclude: false,
      };
    }

    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const current = allAnalyzed.filter(c => c.ongoing)[0];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.isAdvanced, false);
    assert.strictEqual(result.rule, 'six_day');
    assert.strictEqual(result.safeDays, 6);
  });

  it("Anfaengerin: f ausserhalb der Rechenregel → safeDays unveraendert", () => {
    // 12 cycles, earliest=24 → safeDays=4, f on day 6 (outside)
    const entries = {};
    const base = "2025-01-01";
    const lengths = [];
    for (let c = 0; c < 11; c++) lengths.push(28);
    lengths.push(24);
    let offset = 0;
    for (let c = 0; c < lengths.length; c++) {
      const start = addDays(base, offset);
      for (let i = 0; i < lengths[c]; i++) {
        const date = addDays(start, i);
        entries[date] = {
          bleeding: i === 0 ? 1 : 0,
          temperature: "",
          mucus: 1,
          mucusExclude: false,
        };
      }
      offset += lengths[c];
    }
    const curStart = addDays(base, offset);
    for (let i = 0; i < 10; i++) {
      const date = addDays(curStart, i);
      entries[date] = {
        bleeding: i === 0 ? 1 : 0,
        temperature: "36.50",
        mucus: i === 5 ? 3 : 2, // f on day 6
        mucusExclude: false,
      };
    }

    const cycles = detectCycles(entries);
    const allAnalyzed = cycles.map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const current = allAnalyzed.filter(c => c.ongoing)[0];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.isAdvanced, false);
    assert.strictEqual(result.rule, 'calculation');
    assert.strictEqual(result.safeDays, 4);
  });

  // ── Feinbeobachtung "f" ──

  it("Fortgeschrittene: Feinbeobachtung f – Tage vor erstem f sind unfruchtbar", () => {
    const entries = buildEvaluatedCycles(12, "2025-01-01", 28, 17, 11);
    const curStart = addDays("2025-01-01", 12 * 28);
    for (let i = 0; i < 12; i++) {
      const date = addDays(curStart, i);
      entries[date] = {
        bleeding: i === 0 ? 1 : 0,
        temperature: "36.50",
        mucus: i < 3 ? 1 : (i === 3 ? 3 : 2), // f on day 4
        mucusExclude: false,
      };
    }

    const allAnalyzed = getAnalyzedCycles(entries);
    const current = allAnalyzed.filter(c => c.ongoing)[0];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.isAdvanced, true);
    assert.strictEqual(result.rule, 'fine_f');
    assert.strictEqual(result.firstFDay, 4);
    assert.strictEqual(result.safeDays, 3); // days 1-3 infertile
  });

  it("Fortgeschrittene: Feinbeobachtung f am ersten Zyklustag → 0 unfruchtbare Tage", () => {
    const entries = buildEvaluatedCycles(12, "2025-01-01", 28, 17, 11);
    const curStart = addDays("2025-01-01", 12 * 28);
    for (let i = 0; i < 5; i++) {
      const date = addDays(curStart, i);
      entries[date] = {
        bleeding: i === 0 ? 1 : 0,
        temperature: "36.50",
        mucus: i === 0 ? 3 : 2, // f on day 1
        mucusExclude: false,
      };
    }

    const allAnalyzed = getAnalyzedCycles(entries);
    const current = allAnalyzed.filter(c => c.ongoing)[0];
    const result = calculateBeginningInfertility(current, allAnalyzed, entries);
    assert.strictEqual(result.isAdvanced, true);
    assert.strictEqual(result.rule, 'fine_f');
    assert.strictEqual(result.firstFDay, 1);
    assert.strictEqual(result.safeDays, 0);
  });

});

// ── 13. predictNextMenstruation ──
describe("predictNextMenstruation", () => {
  it("nicht ausgewerteter Zyklus → canPredict: false", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 2],
    ]);
    const allAnalyzed = detectCycles(entries).map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const result = predictNextMenstruation(allAnalyzed[0], allAnalyzed, entries);
    assert.strictEqual(result.canPredict, false);
  });

  it("laufender Zyklus ohne abgeschlossene Vorgänger → canPredict: false", () => {
    // Ein Zyklus mit genug Daten für Auswertung, aber keine abgeschlossenen
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.50", 5], [0, "36.80", 2], [0, "36.82", 1],
      [0, "36.81", 1],
    ]);
    const allAnalyzed = detectCycles(entries).map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    assert.strictEqual(allAnalyzed[0].found, true);
    const result = predictNextMenstruation(allAnalyzed[0], allAnalyzed, entries);
    assert.strictEqual(result.canPredict, false);
    // Bei canPredict:false kein completedCount im Ergebnis
  });

  it("ein abgeschlossener Vorgänger-Zyklus → Vorhersage möglich", () => {
    const entries = {};
    // 15-Tage Zyklus, damit infertile Phase positiv ist (infertileFrom liegt vor Zyklusende)
    const buildCycle = (startDate) => {
      const specs = [
        [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
        [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
        [0, "36.50", 5], // peak day 7
        [0, "36.80", 2], // umr 1, day 8
        [0, "36.82", 1], // umr 2, day 9
        [0, "36.81", 1], // umr 3, day 10 → infertileFrom day 11
        [0, "36.50", 1], [0, "36.50", 1], [0, "36.50", 1],
        [0, "36.50", 1], [0, "36.50", 1],
      ];
      for (let i = 0; i < specs.length; i++) {
        const date = addDays(startDate, i);
        entries[date] = {
          bleeding: specs[i][0],
          temperature: specs[i][1],
          tempExclude: false,
          mucus: specs[i][2],
          mucusExclude: false,
        };
      }
    };
    buildCycle("2025-06-01");
    buildCycle("2025-06-16");

    const allAnalyzed = detectCycles(entries).map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    assert.strictEqual(allAnalyzed[0].found, true);
    assert.strictEqual(allAnalyzed[0].length, 15);
    const result = predictNextMenstruation(allAnalyzed[1], allAnalyzed, entries);
    assert.strictEqual(result.canPredict, true);
    assert.strictEqual(result.avgCycleLength, 15);
    assert.ok(result.nextFromLength);
    assert.ok(result.avgInfertilePhase > 0);
    assert.ok(result.nextFromInfertile);
  });
});
