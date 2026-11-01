#!/usr/bin/env node
'use strict';
/**
 * Registry WHOIS for .co.za – authoritative, never cached.
 *
 *   node cloudflare/whois.js neonlegacies.co.za
 *
 * Prints the raw registry (ZARC) response on stdout. This is the only view
 * that is not delayed by resolver caches, so it is what decides whether the
 * registrar change actually took effect (and whether the old nameservers were
 * really removed – a "partial" change shows up as four nameservers).
 *
 * Exit codes: 0 ok, 2 network failure, 64 bad usage.
 */
import net from 'net';

const domain = (process.argv[2] || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
const server = process.env.WHOIS_SERVER || 'whois.registry.net.za';

if (!domain) {
    console.error('usage: node cloudflare/whois.js <domain>');
    process.exit(64);
}

let settled = false;
const done = (code, body, why) => {
    if (settled) { return; }
    settled = true;
    if (why) { console.error('whois failed: ' + why); }
    if (body) { process.stdout.write(body); }
    socket.destroy();
    process.exit(code);
};

const socket = net.createConnection({ host: server, port: 43 });
socket.setEncoding('utf8');
socket.setTimeout(20000);

let body = '';
socket.on('connect', () => socket.write(domain + '\r\n'));
socket.on('data', (chunk) => { body += chunk; });
socket.on('timeout', () => done(2, '', 'timeout talking to ' + server));
socket.on('error', (err) => done(2, '', err.code || err.message));
socket.on('end', () => {
    if (!body.trim()) { return done(2, '', 'empty response from ' + server); }
    done(0, body);
});
