/**
 * Minimal Google Apps Script runtime stub so Code.gs can be exercised in Node.
 * Only the surface Code.gs actually touches is implemented.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSheet(name, rows) {
  const sheet = {
    name: name,
    rows: rows ? rows.map(r => r.slice()) : [],
    frozenRows: 0,
    bold: [],
    getLastRow() { return this.rows.length; },
    getLastColumn() {
      return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getMaxRows() { return Math.max(this.rows.length, 1000); },
    appendRow(row) { this.rows.push(row.slice()); },
    deleteRow(index) { this.rows.splice(index - 1, 1); },
    setFrozenRows(n) { this.frozenRows = n; },
    getRange(r, c, nr, nc) {
      const sheetRef = this;
      const rowsCount = nr === undefined ? 1 : nr;
      const colsCount = nc === undefined ? 1 : nc;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < rowsCount; i++) {
            const row = sheetRef.rows[r - 1 + i] || [];
            const line = [];
            for (let j = 0; j < colsCount; j++) {
              line.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
            }
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
        setValue(value) {
          const idx = r - 1;
          while (sheetRef.rows.length <= idx) { sheetRef.rows.push([]); }
          sheetRef.rows[idx][c - 1] = value;
          return this;
        },
        setFontWeight(weight) { sheetRef.bold.push({ r, c, rowsCount, colsCount, weight }); return this; },
        setDataValidation(rule) { sheetRef.validation = { r, c, rowsCount, colsCount, rule }; return this; }
      };
    }
  };
  return sheet;
}

function toHex(buffer) {
  return Array.from(buffer).map(b => (b < 16 ? '0' : '') + b.toString(16)).join('');
}

function loadCode(initialSheets) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  const sheets = {};
  Object.keys(initialSheets || {}).forEach(name => {
    sheets[name] = makeSheet(name, initialSheets[name]);
  });

  const cache = new Map();
  const props = new Map();
  const mail = [];
  const ss = {
    getSheetByName: name => sheets[name] || null,
    insertSheet(name) { sheets[name] = makeSheet(name); return sheets[name]; }
  };

  const sandbox = {
    console,
    JSON, Date, Math, String, Number, Object, Array, RegExp, decodeURIComponent, encodeURIComponent, Error,
    ContentService: {
      MimeType: { JSON: 'application/json', HTML: 'text/html' },
      createTextOutput(text) {
        return {
          body: text,
          mime: null,
          setMimeType(mime) { this.mime = mime; return this; },
          getContent() { return text; }
        };
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
      },
      getScriptProperties() {
        return { getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          get: k => (cache.has(k) ? cache.get(k) : null),
          put: (k, v) => cache.set(k, v),
          remove: k => cache.delete(k)
        };
      }
    },
    LockService: {
      getScriptLock() { return { waitLock() {}, releaseLock() {} }; }
    },
    MailApp: { sendEmail: options => mail.push(options) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => crypto.randomUUID(),
      formatDate: (date, tz, pattern) => {
        const d = new Date(date);
        const pad = n => String(n).padStart(2, '0');
        return pattern
          .replace('yyyy', String(d.getUTCFullYear()))
          .replace('yy', String(d.getUTCFullYear()).slice(2))
          .replace('MM', pad(d.getUTCMonth() + 1))
          .replace('dd', pad(d.getUTCDate()))
          .replace('HH', pad(d.getUTCHours()))
          .replace('mm', pad(d.getUTCMinutes()));
      },
      computeDigest: (algorithm, value) => {
        const input = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(Array.from(value, b => (b + 256) % 256));
        return Array.from(crypto.createHash('sha256').update(input).digest());
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'Code.gs' });

  function doPost(body) {
    const response = sandbox.doPost({ postData: { contents: JSON.stringify(body) }, parameter: {} });
    return response;
  }

  return {
    sheet: name => sheets[name || 'Leads'],
    sheets,
    mail,
    cache,
    props,
    /** Raw ContentService reply (used by the auth transport test). */
    postRaw: params => doPost(params),
    /** Lead submission – returns the parsed JSON reply. */
    doPost: body => JSON.parse(doPost(body).body),
    /** Account call – parses the postMessage payload out of the HTML reply. */
    auth: (action, params) => {
      const request = Object.assign({ action: action, requestId: 'req-1' }, params);
      const html = doPost(request).body;
      const match = /postMessage\((\{.*?\}), '\*'\)/.exec(html);
      if (!match) { throw new Error('no postMessage payload in reply: ' + html.slice(0, 200)); }
      const message = JSON.parse(match[1].replace(/\\u003c/g, '<'));
      return message.result;
    },
    doGet: params => {
      const response = sandbox.doGet({ parameter: params || {} });
      return response.mime === 'application/json' ? JSON.parse(response.body) : response.body;
    },
    canonicalize: data => sandbox.canonicalize(data),
    headers: () => sandbox.HEADERS,
    run: (fn, arg) => sandbox[fn](arg)
  };
}

module.exports = { loadCode };
