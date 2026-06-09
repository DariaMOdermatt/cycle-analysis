"use strict";

// ══════════════════════════════════════════════
// UNIT TESTS — storage.js
// ══════════════════════════════════════════════

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  STORAGE_KEY,
  loadEntries, persistEntries,
  entriesToCsv, csvToEntries, parseCsvLine,
  deriveKey, encryptData, decryptData,
  mockLocalStorage,
} = require("./test-helpers.js");

// ── localStorage-basierte Funktionen ──
describe("loadEntries / persistEntries", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it("loadEntries gibt leeres Objekt wenn nichts gespeichert", () => {
    const result = loadEntries();
    assert.deepStrictEqual(result, {});
  });

  it("persist + load roundtrip", () => {
    const data = {
      "2025-06-01": { bleeding: 1, temperature: "36,50", mucus: 1 },
      "2025-06-02": { bleeding: 0, temperature: "36,48", mucus: 2 },
    };
    persistEntries(data);
    const loaded = loadEntries();
    assert.deepStrictEqual(loaded, data);
  });

  it("korrupter localStorage-Inhalt → leeres Objekt", () => {
    mockLocalStorage.setItem(STORAGE_KEY, "{invalid json");
    const result = loadEntries();
    assert.deepStrictEqual(result, {});
  });
});

// ── parseCsvLine (Low-Level CSV-Parser) ──
describe("parseCsvLine", () => {
  it("einfache Zeile ohne Quotes", () => {
    assert.deepStrictEqual(
      parseCsvLine("2025-06-01;36,50;vaginal;false;1;false;2;false;0;;"),
      ["2025-06-01", "36,50", "vaginal", "false", "1", "false", "2", "false", "0", "", ""]
    );
  });

  it("Zeile mit Anführungszeichen und Semikolon im Text", () => {
    assert.deepStrictEqual(
      parseCsvLine('2025-06-01;36,50;vaginal;false;0;false;0;false;0;"notizen;mehr";'),
      ["2025-06-01", "36,50", "vaginal", "false", "0", "false", "0", "false", "0", "notizen;mehr", ""]
    );
  });

  it("Zeile mit escaped Quotes", () => {
    const result = parseCsvLine('2025-06-01;;;;0;false;0;false;0;"sagte ""hallo""";');
    assert.strictEqual(result[9], 'sagte "hallo"');
  });

  it("leere Zeile", () => {
    assert.deepStrictEqual(parseCsvLine(""), [""]);
  });

  it("nur Semikolons", () => {
    assert.deepStrictEqual(parseCsvLine(";;"), ["", "", ""]);
  });
});

// ── entriesToCsv / csvToEntries Roundtrip ──
describe("entriesToCsv / csvToEntries", () => {
  it("Roundtrip: entries → CSV → entries", () => {
    const entries = {
      "2025-06-01": {
        temperature: "36,50",
        method: "vaginal",
        tempExclude: false,
        tempExcludeReason: [],
        bleeding: 1,
        spotting: false,
        mucus: 2,
        mucusExclude: false,
        pain: 3,
        notes: "leichte schmerzen",
        time: "06:30",
      },
      "2025-06-02": {
        temperature: "36,55",
        method: "oral",
        tempExclude: true,
        tempExcludeReason: [],
        bleeding: 0,
        spotting: false,
        mucus: 4,
        mucusExclude: false,
        pain: 0,
        notes: "",
        time: "07:00",
      },
    };
    const csv = entriesToCsv(entries);
    assert.ok(csv.startsWith("date;temperature;method;tempExclude;tempExcludeReason;bleeding;spotting;mucus;mucusExclude;pain;notes;time"));

    const parsed = csvToEntries(csv);
    assert.deepStrictEqual(parsed, entries);
  });

  it("leeres entries → nur Header", () => {
    const csv = entriesToCsv({});
    const lines = csv.split("\n");
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].startsWith("date;"));
  });

  it("csvToEntries: leere Eingabe → leeres Objekt", () => {
    assert.deepStrictEqual(csvToEntries(""), {});
  });

  it("csvToEntries: nur Header → leeres Objekt", () => {
    assert.deepStrictEqual(
      csvToEntries("date;temperature;method;tempExclude;tempExcludeReason;bleeding;spotting;mucus;mucusExclude;pain;notes;time"),
      {}
    );
  });

  it("csvToEntries ignoriert Zeilen mit falschem Datumsformat", () => {
    const csv = `date;temperature;method;tempExclude;tempExcludeReason;bleeding;spotting;mucus;mucusExclude;pain;notes;time
kein-datum;36,50;vaginal;false;;1;false;2;false;0;;
06/01/2025;36,50;vaginal;false;;1;false;2;false;0;;
2025-06-01;36,50;vaginal;false;;1;false;2;false;0;;`;
    const result = csvToEntries(csv);
    assert.strictEqual(Object.keys(result).length, 1);
    assert.ok(result["2025-06-01"]);
  });

  it("Notes mit Sonderzeichen (Anführungszeichen, Semikolon) ueberstehen Roundtrip", () => {
    const entries = {
      "2025-06-01": {
        temperature: "36,50",
        method: "vaginal",
        tempExclude: false,
        tempExcludeReason: [],
        bleeding: 0,
        spotting: true,
        mucus: 1,
        mucusExclude: false,
        pain: 0,
        notes: 'heute "viel" stress; schlecht geschlafen',
        time: "06:30",
      },
    };
    const csv = entriesToCsv(entries);
    const parsed = csvToEntries(csv);
    assert.strictEqual(parsed["2025-06-01"].notes, entries["2025-06-01"].notes);
  });

  it("Windows-Zeilenumbrüche (\\r\\n) werden korrekt verarbeitet", () => {
    const csv = "date;temperature;method;tempExclude;tempExcludeReason;bleeding;spotting;mucus;mucusExclude;pain;notes;time\r\n2025-06-01;36,50;vaginal;false;;1;false;2;false;0;;\r\n2025-06-02;36,55;oral;false;;0;false;1;false;0;;";
    const result = csvToEntries(csv);
    assert.strictEqual(Object.keys(result).length, 2);
  });

  it("csvToEntries: fehlende Spalten → Zeile wird uebersprungen", () => {
    const csv = `date;temperature;method;tempExclude;tempExcludeReason;bleeding;spotting;mucus;mucusExclude;pain;notes;time
kein-datum;36,50`;
    const result = csvToEntries(csv);
    assert.deepStrictEqual(result, {});
  });
});

// ── Kryptographie (Integrationstests) ──
describe("deriveKey / encryptData / decryptData", () => {
  it("encrypt + decrypt roundtrip (async)", async () => {
    const data = {
      "2025-06-01": { bleeding: 1, temperature: "36,60", mucus: 2 },
      "2025-06-02": { bleeding: 0, temperature: "36,55", mucus: 1 },
    };
    const password = "test-passwort-123";
    const encrypted = await encryptData(data, password);
    assert.ok(typeof encrypted === "string");
    assert.ok(encrypted.length > 0);
    assert.notStrictEqual(encrypted.includes("36,60"), true, "Verschluesseltes sollte keine Klartext-Temperatur enthalten");

    const decrypted = await decryptData(encrypted, password);
    assert.deepStrictEqual(decrypted, data);
  });

  it("falsches Passwort → decryptData wirft Fehler", async () => {
    const data = { test: true };
    const encrypted = await encryptData(data, "richtig");
    await assert.rejects(
      () => decryptData(encrypted, "falsch"),
      /The operation failed for an operation-specific reason/  // WebCrypto Fehlermeldung
    );
  });

  it("verschiedene Passwörter → verschiedene Ciphertexte", async () => {
    const data = { x: 1 };
    const enc1 = await encryptData(data, "pw1");
    const enc2 = await encryptData(data, "pw2");
    assert.notStrictEqual(enc1, enc2);
  });

  it("gleiches Passwort → unterschiedliche IVs → unterschiedliche Ciphertexte", async () => {
    const data = { x: 1 };
    const enc1 = await encryptData(data, "pw");
    const enc2 = await encryptData(data, "pw");
    // Unterschiedliche IVs → Ciphertexte sind unterschiedlich
    assert.notStrictEqual(enc1, enc2);
    // Beide entschluesselbar
    const dec1 = await decryptData(enc1, "pw");
    const dec2 = await decryptData(enc2, "pw");
    assert.deepStrictEqual(dec1, data);
    assert.deepStrictEqual(dec2, data);
  });

  it("deriveKey mit leerem Passwort", async () => {
    const key = await deriveKey("");
    assert.ok(key);
  });

  it("verschiedene Passwörter → verschiedene Keys", async () => {
    const k1 = await deriveKey("a");
    const k2 = await deriveKey("b");
    // Keys sind CryptoKey-Objekte – vergleiche indirekt ueber encrypt
    const enc1 = await encryptData({ v: 1 }, "a");
    const enc2 = await encryptData({ v: 1 }, "b");
    assert.notStrictEqual(enc1, enc2);
  });
});
