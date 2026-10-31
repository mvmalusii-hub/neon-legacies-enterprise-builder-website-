#!/usr/bin/env node
/**
 * Audits a Leads / Users CSV exported from the Neon Legacies spreadsheet.
 *
 * Usage:
 *   node apps-script/tools/audit-sheet.js leads.csv [users.csv]
 *
 * Reports: the columns the v3 backend writes, which of them are missing,
 * rows that lost their Name / Email / Phone (the pre-v2 bug), duplicate
 * references, unknown statuses and the per-form breakdown.
 */
'use strict';
const fs = require('fs');

const EXPECTED = ['Timestamp', 'Reference', 'Form', 'Status', 'Name', 'Email',
                  'Phone', 'Company', 'Service / Interest', 'Industry', 'Amount',
                  'Preferred Date', 'Message', 'Page', 'Source ID', 'Payload JSON'];
const STATUSES = ['New', 'Contacted', 'Quoted', 'Won', 'Lost', 'Spam'];
const USER_HEADERS = ['Id', 'Created', 'Name', 'Email', 'Phone', 'Company', 'Role',
                      'Status', 'Salt', 'Hash', 'Iterations', 'Last Login',
                      'Password Changed', 'Reset Token', 'Reset Expires'];

/** RFC-4180 CSV parser (quoted fields, embedded commas/newlines/quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else { field += ch; }
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') { continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(line => line.some(cell => String(cell).trim() !== ''));
}

function toRecords(rows) {
  const headers = (rows.shift() || []).map(h => String(h).trim());
  return {
    headers,
    records: rows.map(line => {
      const record = {};
      headers.forEach((h, i) => { record[h] = line[i] === undefined ? '' : String(line[i]).trim(); });
      return record;
    })
  };
}

function auditLeads(path) {
  const { headers, records } = toRecords(parseCsv(fs.readFileSync(path, 'utf8')));
  const missing = EXPECTED.filter(h => headers.indexOf(h) === -1);
  const extra = headers.filter(h => EXPECTED.indexOf(h) === -1 && h);
  const lost = records.filter(r => !r.Email && !r.Phone && !r.Name);
  const noEmail = records.filter(r => !r.Email);
  const noName = records.filter(r => !r.Name);

  const references = new Map();
  records.forEach(r => {
    if (!r.Reference) { return; }
    references.set(r.Reference, (references.get(r.Reference) || 0) + 1);
  });
  const duplicates = Array.from(references.entries()).filter(([, count]) => count > 1);

  const byForm = new Map();
  records.forEach(r => {
    const form = r.Form || '(blank)';
    byForm.set(form, (byForm.get(form) || 0) + 1);
  });
  const badStatus = records.filter(r => r.Status && STATUSES.indexOf(r.Status) === -1);

  console.log('=== ' + path + ' ===');
  console.log('rows: ' + records.length);
  console.log('columns: ' + headers.length);
  console.log('missing v3 columns: ' + (missing.length ? missing.join(', ') : 'none ✅'));
  if (extra.length) { console.log('extra columns: ' + extra.join(', ')); }
  console.log('unusable rows (no name, email or phone): ' + lost.length +
              (lost.length ? '  <-- these are the leads the v1 backend mangled' : ' ✅'));
  console.log('rows with no email: ' + noEmail.length + ' (spaza/liquor forms allow this)');
  console.log('rows with no name: ' + noName.length);
  console.log('duplicate references: ' + duplicates.length);
  console.log('status values outside the dropdown: ' + badStatus.length);
  console.log('by form:');
  Array.from(byForm.entries()).sort((a, b) => b[1] - a[1])
    .forEach(([form, count]) => console.log('  ' + count.toString().padStart(4) + '  ' + form));
  return { rows: records.length, missing, lost: lost.length };
}

function auditUsers(path) {
  const { headers, records } = toRecords(parseCsv(fs.readFileSync(path, 'utf8')));
  const missing = USER_HEADERS.filter(h => headers.indexOf(h) === -1);
  const noHash = records.filter(r => !r.Hash);
  const inactive = records.filter(r => r.Status && r.Status !== 'active');
  const roles = new Map();
  records.forEach(r => { const role = r.Role || '(blank)'; roles.set(role, (roles.get(role) || 0) + 1); });

  console.log('=== ' + path + ' ===');
  console.log('accounts: ' + records.length);
  console.log('missing v3 columns: ' + (missing.length ? missing.join(', ') : 'none ✅'));
  console.log('accounts without a password hash: ' + noHash.length);
  console.log('non-active accounts: ' + inactive.length);
  console.log('roles: ' + Array.from(roles.entries()).map(([r, c]) => r + '=' + c).join(', '));
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node apps-script/tools/audit-sheet.js leads.csv [users.csv]');
    process.exit(2);
  }
  files.forEach(file => {
    if (/user/i.test(file)) { auditUsers(file); } else { auditLeads(file); }
  });
}

module.exports = { parseCsv, auditLeads, auditUsers };
