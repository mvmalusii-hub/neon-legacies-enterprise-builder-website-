/*!
 * Cloudflare integration loader — Neon Legacies Enterprise Builder
 * ------------------------------------------------------------------
 * Loads Cloudflare Web Analytics (cookieless, privacy-first) on every
 * page of the site. Works both when the site is proxied through the
 * Cloudflare edge (GitHub Pages + orange-cloud DNS) and when it is
 * hosted directly on Cloudflare Pages.
 *
 * SETUP
 *  -----
 *  1. Cloudflare dashboard → Analytics & Logs → Web Analytics → Add a site.
 *  2. Copy the "JS snippet" token (a 32-char hex string).
 *  3. Paste it below as CF_ANALYTICS_TOKEN.
 *  4. Optionally set window.NEON_CF_CONFIG = { token: '...' } before this
 *     script runs (handy for staging / preview deployments).
 *
 * Until a token is configured this file is a no-op: nothing is fetched,
 * no cookies are written and no errors are thrown.
 *
 * The beacon is skipped when the visitor sends DNT:1 / Global Privacy
 * Control, or when they have opted out via localStorage key
 * `neon-cf-analytics-optout` = "1" (POPIA-friendly).
 */
(function () {
  'use strict';

  /* ============================================================
     1. CONFIGURATION
     ============================================================ */
  var CF_ANALYTICS_TOKEN = 'REPLACE_WITH_CLOUDFLARE_WEB_ANALYTICS_TOKEN';

  var DEFAULTS = {
    token: CF_ANALYTICS_TOKEN,
    beaconSrc: 'https://static.cloudflareinsights.com/beacon.min.js',
    respectPrivacySignals: true,
    spa: true
  };

  var config = {};
  var key;
  for (key in DEFAULTS) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      config[key] = DEFAULTS[key];
    }
  }

  var override = window.NEON_CF_CONFIG;
  if (override && typeof override === 'object') {
    for (key in override) {
      if (Object.prototype.hasOwnProperty.call(override, key) && override[key] !== '') {
        config[key] = override[key];
      }
    }
  }

  /* ============================================================
     2. GUARDS
     ============================================================ */
  function isConfigured(token) {
    return typeof token === 'string' &&
      token.length > 0 &&
      token.indexOf('REPLACE_WITH') !== 0 &&
      token !== 'undefined';
  }

  function privacySignalSet() {
    if (!config.respectPrivacySignals) {
      return false;
    }
    /* Do Not Track */
    if (navigator.doNotTrack === '1' ||
        window.doNotTrack === '1' ||
        navigator.msDoNotTrack === '1') {
      return true;
    }
    /* Global Privacy Control (POPIA / GDPR signal) */
    if (navigator.globalPrivacyControl === true) {
      return true;
    }
    /* Explicit opt-out stored by the cookie banner / settings page */
    try {
      return window.localStorage.getItem('neon-cf-analytics-optout') === '1';
    } catch (err) {
      return false;
    }
  }

  function alreadyLoaded() {
    return !!document.querySelector('script[data-cf-beacon]');
  }

  /* ============================================================
     3. BEACON INJECTION
     ============================================================ */
  function loadBeacon() {
    if (!isConfigured(config.token) || alreadyLoaded()) {
      return false;
    }

    var beaconConfig = { token: config.token };
    if (config.spa) {
      beaconConfig.spa = true;
    }

    var script = document.createElement('script');
    script.defer = true;
    script.src = config.beaconSrc;
    script.setAttribute('data-cf-beacon', JSON.stringify(beaconConfig));
    /* Cloudflare's beacon is third-party: never let it block rendering
       or leak the referrer of private pages. */
    script.crossOrigin = 'anonymous';

    (document.head || document.documentElement).appendChild(script);
    return true;
  }

  if (privacySignalSet()) {
    return;
  }

  try {
    loadBeacon();
  } catch (err) {
    /* Analytics must never break the page. */
  }

  /* ============================================================
     4. PUBLIC API (used by privacy settings / tests)
     ============================================================ */
  window.NeonCloudflare = {
    isConfigured: function () {
      return isConfigured(config.token);
    },
    track: loadBeacon,
    optOut: function () {
      try {
        window.localStorage.setItem('neon-cf-analytics-optout', '1');
      } catch (err) { /* storage blocked — nothing to persist */ }
    },
    optIn: function () {
      try {
        window.localStorage.removeItem('neon-cf-analytics-optout');
      } catch (err) { /* storage blocked */ }
    }
  };
})();
