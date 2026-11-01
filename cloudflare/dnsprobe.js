#!/usr/bin/env node
'use strict';
/**
 * Ask ONE nameserver directly – no resolver cache in the way.
 *
 *   node cloudflare/dnsprobe.js <server-ip> <type> <name>
 *   node cloudflare/dnsprobe.js 108.162.192.112 SOA  neonlegacies.co.za
 *   node cloudflare/dnsprobe.js 108.162.192.112 CNAME www.neonlegacies.co.za
 *
 * Used to find out what the Cloudflare zone itself answers, even while the
 * delegation is still half-switched and public resolvers disagree.
 *
 * Prints one value per line (SOA as "<ns> <hostmaster> serial=<n>").
 * An empty answer prints nothing and still exits 0 (that is a real result:
 * the record does not exist). Exit 2 means the server could not be asked.
 */
import dns from 'dns';

const [server, type, name] = process.argv.slice(2);
const TYPES = {
    A: 'resolve4',
    AAAA: 'resolve6',
    CNAME: 'resolveCname',
    NS: 'resolveNs',
    SOA: 'resolveSoa',
    TXT: 'resolveTxt'
};

if (!server || !type || !name || !TYPES[type.toUpperCase()]) {
    console.error('usage: node cloudflare/dnsprobe.js <server-ip> <' +
        Object.keys(TYPES).join('|') + '> <name>');
    process.exit(64);
}

const resolver = new dns.Resolver({ timeout: 5000, tries: 2 });
resolver.setServers([server]);

resolver[TYPES[type.toUpperCase()]](name, (err, records) => {
    if (err) {
        // NXDOMAIN / NODATA are answers, not failures.
        if (err.code === 'ENOTFOUND' || err.code === 'ENODATA' || err.code === 'ENOTIMP') {
            process.exit(0);
        }
        console.error('probe failed: ' + (err.code || err.message));
        process.exit(2);
    }
    if (!records) { process.exit(0); }
    if (type.toUpperCase() === 'SOA') {
        console.log(records.nsname.replace(/\.$/, '') + ' ' +
            String(records.hostmaster).replace(/\.$/, '') +
            ' serial=' + records.serial);
        process.exit(0);
    }
    (Array.isArray(records) ? records : [records])
        .forEach((record) => console.log(String(record).replace(/\.$/, '')));
    process.exit(0);
});
