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

// ── 7. Temperaturanalyse (3-über-6) ──
describe("analyzeTemp", () => {
  it("<9 Werte → nicht bestätigt", () => {
    const entries = {};
    for (let i = 0; i < 6; i++) {
      const date = addDays("2025-07-01", i);
      entries[date] = { bleeding: i === 0 ? 1 : 0, temperature: "36.50", tempExclude: false, mucus: 1 };
    }
    const cycle = { start: "2025-07-01", end: "2025-07-05", length: 5, ongoing: false };
    assert.strictEqual(analyzeTemp(cycle, entries).confirmed, false);
  });

  it("3-über-6: sauberer Shift wird erkannt", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.80", 3], [0, "36.82", 3], [0, "36.81", 3],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-09", length: 9, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    assert.strictEqual(result.confirmed, true);
    assert.ok(result.coverline > 0);
    assert.ok(result.shiftDay > 0);
    assert.ok(result.confirmDate);
  });

  it("3. Wert muss ≥ coverline + 0.2 sein", () => {
    // 6 lows = 36.50 → coverline = 36.50
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 1], [0, "36.50", 1],
      [0, "36.50", 2], [0, "36.50", 2], [0, "36.50", 2],
      [0, "36.51", 2], [0, "36.60", 2], [0, "36.65", 2],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-09", length: 9, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    // coverline = 36.50, 3rd high = 36.65, needs >= 36.70 → false
    assert.strictEqual(result.confirmed, false);
  });

  it("ausgeschlossene Temperaturen werden ignoriert", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "37.50", 3, true], // Fieber – ausgeschlossen
      [0, "36.80", 3], [0, "36.82", 3], [0, "36.81", 3],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-10", length: 10, ongoing: false };
    const result = analyzeTemp(cycle, entries);
    assert.strictEqual(result.confirmed, true);
    assert.notStrictEqual(result.confirmDate, "2025-06-07");
  });

  it("mit mucusPeakDate: Scan startet erst nach dem Peak", () => {
    const entries = {};
    for (let i = 1; i <= 15; i++) {
      const date = addDays("2025-07-01", i - 1);
      entries[date] = {
        bleeding: i === 1 ? 1 : 0,
        temperature: i <= 6 ? "36.50" : (i >= 10 ? "36.80" : "36.50"),
        tempExclude: false,
        mucus: 1,
      };
    }
    const cycle = { start: "2025-07-01", end: "2025-07-15", length: 15, ongoing: false };
    const result = analyzeTemp(cycle, entries, "2025-07-09");
    assert.strictEqual(result.confirmed, true);
    assert.strictEqual(result.confirmDate, "2025-07-12");
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
      [1, "36.50", 1], [0, "36.50", 2], [0, "36.50", 1],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-03", length: 3, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.mucus.found, false);
  });

  it("<9 Temperaturwerte → nicht auswertbar", () => {
    const entries = e([
      [1, "36.50", 4], [0, "36.52", 2],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-02", length: 2, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.criteria.enoughTemps.met, false);
  });

  it("vollständig ausgewerteter Zyklus mit 3 umrandeten Messungen", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.50", 5], // Peak S+
      [0, "36.80", 2], // umrandet 1
      [0, "36.82", 1], // umrandet 2
      [0, "36.81", 1], // umrandet 3
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-10", length: 10, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.mucus.found, true);
    assert.strictEqual(result.temp.confirmed, true);
    assert.strictEqual(result.criteria.threeEncircled.met, true);
    assert.ok(result.infertileFrom);
  });

  it("3. umrandete < coverline+0.2 → braucht 4 umrandete", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.50", 5], // Peak → coverline ≈ 36.52
      [0, "36.53", 2], // umr 1
      [0, "36.54", 1], // umr 2
      [0, "36.55", 1], // umr 3 (36.55 < 36.52+0.2=36.72)
      [0, "36.56", 1], // umr 4 → reicht
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-11", length: 11, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.criteria.threeEncircled.met, true);
    assert.ok(result.infertileFrom);
  });

  it("nur 1 umrandete Messung → nicht genug", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.48", 1], [0, "36.52", 1],
      [0, "36.50", 2], [0, "36.49", 2], [0, "36.51", 2],
      [0, "36.50", 5], // Peak
      [0, "36.55", 2], // umr 1
      [0, "36.50", 1], // nicht umr
      [0, "36.50", 1], // nicht umr
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-10", length: 10, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.criteria.threeEncircled.met, false);
  });

  it("Coverline = max der 6 tiefsten pre-Peak Werte", () => {
    const entries = e([
      [1, "36.80", 1], [0, "36.60", 1], [0, "36.70", 1],
      [0, "36.50", 1], [0, "36.55", 1], [0, "36.65", 1],
      [0, "36.50", 5], // Peak
      [0, "36.90", 2], [0, "36.91", 2], [0, "36.92", 2],
      [0, "36.93", 2],
    ]);
    const cycle = { start: "2025-06-01", end: "2025-06-11", length: 11, ongoing: false };
    const result = analyzeUmrandeterTag(cycle, entries);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.temp.coverline, 36.80);
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
  it("nicht ausgewerteter Zyklus → alle Tage infertile", () => {
    const entries = e([
      [1, "36.50", 1], [0, "36.50", 2], [0, "36.50", 1],
    ]);
    const allAnalyzed = detectCycles(entries).map(c => ({ ...c, ...analyzeUmrandeterTag(c, entries) }));
    const current = allAnalyzed[0];
    const fert = computeFertility(current, allAnalyzed, entries);
    for (const status of Object.values(fert.result)) {
      assert.strictEqual(status, "infertile");
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
      if (d < endDate) {
        assert.strictEqual(status, "fertile", `Tag ${d} sollte fertile sein`);
      } else {
        assert.strictEqual(status, "infertile", `Tag ${d} sollte infertile sein`);
      }
    }
  });
});

// ── 12. predictNextMenstruation ──
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
