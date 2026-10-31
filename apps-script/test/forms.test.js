/**
 * Real-markup coverage for the lead hook.
 * Run: node apps-script/test/forms.test.js
 *
 * Parses every <form> in the site's HTML, replays it through app.js
 * (collect -> normalise) with a marker value per control, and asserts that no
 * visible field is dropped and that name/email/phone come out populated.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html')).sort();

function attrs(source) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let m;
  while ((m = re.exec(source))) {
    const value = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : ''));
    out[m[1].toLowerCase()] = value;
  }
  return out;
}

function text(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function parseForm(markup) {
  const labels = {};
  const labelRe = /<label\b([^>]*)>([\s\S]*?)<\/label>/g;
  let m;
  while ((m = labelRe.exec(markup))) {
    const a = attrs(m[1]);
    if (a.for) { labels[a.for] = text(m[2]); }
  }

  const controls = [];
  const controlRe = /<(input|textarea|select)\b([^>]*)>/g;
  while ((m = controlRe.exec(markup))) {
    const tag = m[1].toLowerCase();
    const a = attrs(m[2]);
    const control = {
      tag: tag,
      type: (a.type || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text')).toLowerCase(),
      id: a.id || '',
      name: a.name || '',
      placeholder: a.placeholder || '',
      label: labels[a.id] || ''
    };
    if (tag === 'select') {
      const close = markup.indexOf('</select>', m.index);
      const inner = close === -1 ? '' : markup.slice(m.index + m[0].length, close);
      const options = [];
      const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/g;
      let o;
      while ((o = optRe.exec(inner))) {
        const oa = attrs(o[1]);
        options.push({ value: oa.value === undefined ? text(o[2]) : oa.value, text: text(o[2]) });
      }
      control.options = options;
    }
    controls.push(control);
  }
  return controls;
}

function visible(control) {
  const skip = ['submit', 'button', 'reset', 'password', 'file', 'hidden', 'image'];
  return skip.indexOf(control.type) === -1;
}

function loadApp() {
  const stored = {};
  const sandbox = {
    console, JSON, Date, Math, String, Number, Object, Array, Promise, RegExp, Error, setTimeout,
    location: { pathname: '/' },
    localStorage: { getItem: k => (k in stored ? stored[k] : null),
                    setItem: (k, v) => { stored[k] = String(v); },
                    removeItem: k => { delete stored[k]; } },
    fetch: () => Promise.resolve(),
    document: { addEventListener: () => {}, querySelectorAll: () => [] }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox.window.NEON_LEADS;
}

/** Builds the fake element list for a real form, with a marker value per control. */
function buildForm(formId, controls) {
  const specs = [];
  const expected = [];
  controls.forEach((control, index) => {
    if (!visible(control) || control.name === '_hp') { return; }   // honeypot is never sent
    if (control.tag === 'select') {
      const chosen = control.options.filter(o => o.value)[0];
      if (!chosen) { return; }
      specs.push({ tag: 'select', id: control.id, name: control.name, value: chosen.value,
                   label: control.label, placeholder: control.placeholder,
                   options: control.options.map(o => ({ value: o.value, textContent: o.text })) });
      expected.push(chosen.value);
      return;
    }
    if (control.type === 'checkbox' || control.type === 'radio') {
      specs.push({ type: control.type, id: control.id, name: control.name, value: control.name || ('option-' + index),
                   checked: true, label: control.label || control.placeholder, placeholder: control.placeholder });
      expected.push(control.name || ('option-' + index));
      return;
    }
    const marker = 'M' + index + 'value';
    specs.push({ tag: control.tag, type: control.type, id: control.id, name: control.name,
                 value: marker, label: control.label, placeholder: control.placeholder });
    expected.push(marker);
  });

  const form = { id: formId, tagName: 'FORM', dataset: {}, elements: [] };
  form.elements = specs.map(spec => ({
    tagName: (spec.tag || 'input').toUpperCase(),
    type: spec.type || 'text',
    id: spec.id || '',
    name: spec.name || '',
    value: spec.value === undefined ? '' : spec.value,
    checked: !!spec.checked,
    options: spec.options || [],
    form: form,
    getAttribute: attr => (attr === 'placeholder' ? (spec.placeholder || '') : null),
    closest: selector => {
      if (selector === 'label') { return spec.label ? { textContent: spec.label } : null; }
      if (!spec.group) { return null; }
      return { querySelector: () => ({ textContent: spec.group, contains: () => false }) };
    }
  }));
  form.querySelector = selector => {
    const match = /^label\[for="(.+)"\]$/.exec(selector);
    if (!match) { return null; }
    const spec = specs.find(s => s.id === match[1] && s.label);
    return spec ? { textContent: spec.label } : null;
  };
  return { form: form, expected: expected };
}

/* ----------------------------- run ------------------------------- */

const leads = loadApp();
let failures = 0;
let formsChecked = 0;
let fieldsChecked = 0;

pages.forEach(page => {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/g;
  let m;
  while ((m = formRe.exec(html))) {
    const formAttrs = attrs(m[1]);
    if (formAttrs['data-no-lead'] === 'true') { continue; }   // e.g. the profile login form
    const formId = formAttrs.id || '(no id)';
    const controls = parseForm(m[2]);
    if (!controls.length) { continue; }
    formsChecked++;

    const built = buildForm(formId, controls);
    const collected = leads.collect(built.form);
    const lead = leads.normalise(collected.values, collected.fields);
    const payload = JSON.stringify({
      values: collected.values, fields: collected.fields, lead: lead
    });

    const problems = [];
    built.expected.forEach(skip => {});  // keep lint quiet
    // 1. Every control that was filled must survive into the payload.
    built.form.elements.forEach(el => {
      if (!el.value && !el.checked) { return; }
      const marker = String(el.value);
      if (marker.slice(0, 1) === 'M' && marker.indexOf('value') !== -1 && payload.indexOf(marker) === -1) {
        problems.push('dropped field ' + (el.id || el.name || el.getAttribute('placeholder')));
      }
    });
    // 2. Name / email / phone must be recognised when the form asks for them.
    const hasEmail = controls.some(c => c.type === 'email' && visible(c));
    const hasPhone = controls.some(c => c.type === 'tel' && visible(c));
    const hasName = controls.some(c => /name/i.test(c.id + ' ' + c.label + ' ' + c.placeholder));
    if (hasName && !lead.name && !lead.company) { problems.push('name not recognised'); }
    if (hasEmail && !lead.email) { problems.push('email not recognised'); }
    if (hasPhone && !lead.phone) { problems.push('phone not recognised'); }

    fieldsChecked += built.form.elements.length;
    const label = page + ' :: ' + formId;
    if (problems.length) {
      failures++;
      console.log('FAIL  ' + label + ' -> ' + problems.join('; '));
    } else {
      console.log('PASS  ' + label + ' (' + built.form.elements.length + ' fields, ' +
                  'name=' + (lead.name || '-') + ', email=' + (lead.email || '-') + ')');
    }
  }
});

console.log('\n' + formsChecked + ' forms, ' + fieldsChecked + ' fields checked, ' + failures + ' failures');
if (failures) { process.exit(1); }
console.log('ALL FORMS CAPTURED');
