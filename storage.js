// ══════════════════════════════════════════════
// STORAGE & ENCRYPTION
// ══════════════════════════════════════════════

const STORAGE_KEY = "cycle-tracker-entries";

function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function persistEntries(e) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(e)); }
  catch {}
}

// Settings
const SETTINGS_KEY = "cycle-tracker-settings";
const DEFAULT_TEMP_EXCLUDE_REASONS = ["Krankheit", "ungewöhnlich späte Messzeit"];

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    var reasons = DEFAULT_TEMP_EXCLUDE_REASONS.slice();
    if (Array.isArray(saved.tempExcludeReasons)) {
      for (var j = 0; j < saved.tempExcludeReasons.length; j++) {
        if (reasons.indexOf(saved.tempExcludeReasons[j]) === -1) reasons.push(saved.tempExcludeReasons[j]);
      }
    }
    var excludedCycles = Array.isArray(saved.excludedCycles) ? saved.excludedCycles.slice() : [];
    return { tempExcludeReasons: reasons, excludedCycles: excludedCycles };
  } catch(e) { return { tempExcludeReasons: DEFAULT_TEMP_EXCLUDE_REASONS.slice(), excludedCycles: [] }; }
}

function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch(e) {}
}

function entriesToCsv(entries) {
  const header = "date;temperature;method;tempExclude;tempExcludeReason;bleeding;spotting;mucus;mucusExclude;pain;notes;time";
  const lines = [header];
  const dates = Object.keys(entries).sort();
  for (const d of dates) {
    const en = entries[d];
    const row = [
      d,
      en.temperature || "",
      en.method || "vaginal",
      en.tempExclude ? "true" : "false",
      en.tempExcludeReason && en.tempExcludeReason.length ? JSON.stringify(en.tempExcludeReason) : "",
      en.bleeding || 0,
      en.spotting ? "true" : "false",
      en.mucus || 0,
      en.mucusExclude ? "true" : "false",
      en.pain || 0,
      (en.notes || "").replace(/"/g, '""'),
      en.time || ""
    ];
    const csvRow = row.map(val => {
      const s = String(val);
      return (s.includes(';') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(csvRow.join(';'));
  }
  return lines.join('\n');
}

function csvToEntries(csv) {
  const entries = {};
  // Strip BOM if present
  const cleanCsv = csv.charCodeAt(0) === 0xFEFF ? csv.slice(1) : csv;
  const lines = cleanCsv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return entries;
  const header = lines[0].split(';');
  const colIdx = {};
  for (let i = 0; i < header.length; i++) colIdx[header[i]] = i;
  function getVal(vals, col) { return col in colIdx ? (vals[colIdx[col]] || "") : ""; }
  function parseReasons(val) {
    if (!val) return [];
    if (val.startsWith('[')) { try { return JSON.parse(val); } catch(e) { return [val]; } }
    return [val];
  }

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCsvLine(lines[i]);
    let date = getVal(vals, 'date');
    // Accept German date format (DD.MM.YYYY) and convert to ISO
    const germanMatch = date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (germanMatch) {
      date = germanMatch[3] + '-' + germanMatch[2] + '-' + germanMatch[1];
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    entries[date] = {
      temperature: getVal(vals, 'temperature'),
      method: getVal(vals, 'method') || "vaginal",
      tempExclude: getVal(vals, 'tempExclude') === "true",
      tempExcludeReason: parseReasons(getVal(vals, 'tempExcludeReason')),
      bleeding: parseInt(getVal(vals, 'bleeding')) || 0,
      spotting: getVal(vals, 'spotting') === "true",
      mucus: parseInt(getVal(vals, 'mucus')) || 0,
      mucusExclude: getVal(vals, 'mucusExclude') === "true",
      pain: parseInt(getVal(vals, 'pain')) || 0,
      notes: getVal(vals, 'notes').replace(/""/g, '"'),
      time: getVal(vals, 'time')
    };
  }
  return entries;
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ';') {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

async function deriveKey(pw) {
  const e = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", e.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: e.encode("cycle-tracker-salt-2024"), iterations: 100000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(data, pw) {
  const key = await deriveKey(pw);
  const e = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, e.encode(JSON.stringify(data)));
  return JSON.stringify({ iv: Array.from(iv), data: Array.from(new Uint8Array(enc)) });
}

async function decryptData(str, pw) {
  const key = await deriveKey(pw);
  const { iv, data } = JSON.parse(str);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, new Uint8Array(data));
  return JSON.parse(new TextDecoder().decode(dec));
}
