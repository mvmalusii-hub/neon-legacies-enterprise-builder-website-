/**
 * Minimal Google Apps Script runtime stub so Code.gs can be exercised in Node.
 * Only the surface Code.gs actually touches is implemented.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSheet(name) {
  const sheet = {
    name: name, rows: [],
    frozenRows: 0, bold: [],
    getLastRow() { return this.rows.length; },
    getLastColumn() {
      return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getMaxRows() { return Math.max(this.rows.length, 1000); },
    appendRow(row) { this.rows.push(row.slice()); },
    setFrozenRows(n) { this.frozenRows = n; },
    getRange(r, c, nr, nc) {
      const sheetRef = this;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = sheetRef.rows[r - 1 + i] || [];
            const line = [];
            for (let j = 0; j < nc; j++) { line.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); }
            out.push(line);
          }
          return out;
        },
        setValues(values) {
          values.forEach((line, i) => {
            const idx = r - 1 + i;
            while (sheetRef.rows.length <= idx) { sheetRef.rows.push([]); }
            line.forEach((value, j) => { sheetRef.rows[idx][c - 1 + j] = value; });
          });
          return this;
        },
        setFontWeight(weight) { sheetRef.bold.push({ r, c, nr, nc, weight }); return this; },
        setDataValidation(rule) { sheetRef.validation = { r, c, nr, nc, rule }; return this; }
      };
    }
  };
  return sheet;
}

function loadCode(sheetRows) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const sheets = {};
  if (sheetRows) { sheets.Leads = Object.assign(makeSheet('Leads'), { rows: sheetRows.map(r => r.slice()) }); }

  const cache = new Map();
  const props = new Map();
  const mail = [];

  const sandbox = {
    console,
    JSON, Date, Math, String, Number, Object, Array, RegExp, decodeURIComponent, Error,
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return { body: text, setMimeType() { return this; }, getContent() { return text; } };
      }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() { return ss; },
      openById() { return ss; },
      newDataValidation() {
        return {
          requireValueInList() { return this; },
          setAllowInvalid() { return this; },
          build() { return { kind: 'list' }; }
        };
      }
    },
    PropertiesService: {
      getDocumentProperties() {
        return { getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          get: k => (cache.has(k) ? cache.get(k) : null),
          put: (k, v) => cache.set(k, v)
        };
      }
    },
    LockService: {
      getScriptLock() { return { waitLock() {}, releaseLock() {} }; }
    },
    MailApp: { sendEmail: options => mail.push(options) },
    Utilities: {
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2, 10),
      formatDate: () => '261031'
    }
  };

  const ss = {
    getSheetByName: name => sheets[name] || null,
    insertSheet(name) { sheets[name] = makeSheet(name); return sheets[name]; }
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'Code.gs' });

  return {
    sheet: () => sheets.Leads,
    mail,
    cache,
    props,
    doPost: body => {
      const response = sandbox.doPost({ postData: { contents: JSON.stringify(body) }, parameter: {} });
      return JSON.parse(response.body);
    },
    doGet: () => JSON.parse(sandbox.doGet().body),
    canonicalize: data => sandbox.canonicalize(data),
    headers: () => sandbox.HEADERS,
    run: fn => sandbox[fn]()
  };
}

module.exports = { loadCode };
