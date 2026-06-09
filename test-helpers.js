"use strict";

// ══════════════════════════════════════════════
// TEST HELPERS – Load engine.js & storage.js
// ══════════════════════════════════════════════
//
// Die Quell-Dateien definieren alles im globalen Scope
// (keine ES-Module, kein CommonJS). Zum Testen mit
// node:test muessen sie in den globalen Scope geladen werden.
//
// Strategy: `const` auf Top-Level wird zu `var` transformiert,
// damit die Variablen an globalThis gebunden werden.
// `function`-Deklarationen sind ohnehin global.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const JS_DIR = path.resolve(__dirname);
const ENGINE_PATH = path.join(JS_DIR, "engine.js");
const STORAGE_PATH = path.join(JS_DIR, "storage.js");

function loadAsScript(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  // Nur Top-Level `const` ersetzen (keine eingerueckten in Funktionen)
  const transformed = raw.replace(/^const /gm, "var ");
  // storage.js greift auf localStorage zu – vorher mocken
  vm.runInThisContext(transformed);
}

// Mock localStorage fuer storage.js
globalThis.localStorage = {
  _data: {},
  getItem(key) { return this._data[key] ?? null; },
  setItem(key, val) { this._data[key] = val; },
  removeItem(key) { delete this._data[key]; },
  clear() { this._data = {}; },
};

loadAsScript(STORAGE_PATH);
loadAsScript(ENGINE_PATH);

// Re-export als Modul-Objekt fuer bequemen Zugriff in Tests
module.exports = {
  // engine.js
  fmt: globalThis.fmt,
  parseLocal: globalThis.parseLocal,
  daysBetween: globalThis.daysBetween,
  addDays: globalThis.addDays,
  roundTemp: globalThis.roundTemp,
  getDaysInMonth: globalThis.getDaysInMonth,
  getFirstDayOfWeek: globalThis.getFirstDayOfWeek,
  MUCUS: globalThis.MUCUS,
  MONTHS_DE: globalThis.MONTHS_DE,
  DAYS_DE: globalThis.DAYS_DE,
  detectCycles: globalThis.detectCycles,
  getCycleDates: globalThis.getCycleDates,
  analyzeTemp: globalThis.analyzeTemp,
  analyzeMucus: globalThis.analyzeMucus,
  analyzeUmrandeterTag: globalThis.analyzeUmrandeterTag,
  fullAnalysis: globalThis.fullAnalysis,
  computeFertility: globalThis.computeFertility,
  predictNextMenstruation: globalThis.predictNextMenstruation,
  // storage.js
  STORAGE_KEY: globalThis.STORAGE_KEY,
  loadEntries: globalThis.loadEntries,
  persistEntries: globalThis.persistEntries,
  entriesToCsv: globalThis.entriesToCsv,
  csvToEntries: globalThis.csvToEntries,
  parseCsvLine: globalThis.parseCsvLine,
  deriveKey: globalThis.deriveKey,
  encryptData: globalThis.encryptData,
  decryptData: globalThis.decryptData,
  mockLocalStorage: globalThis.localStorage,
};
