// ============================================================
//  Backend status page – proves the Apps Script deployment works
//  and that the site's endpoint actually points at it.
// ============================================================
(function () {
    'use strict';

    var resultEl = document.getElementById('statusResult');
    var endpointEl = document.getElementById('statusEndpoint');
    var versionEl = document.getElementById('statusVersion');
    var leadsEl = document.getElementById('statusLeads');
    var usersEl = document.getElementById('statusUsers');
    var sessionsEl = document.getElementById('statusSessions');
    var timeEl = document.getElementById('statusTime');
    var helpEl = document.getElementById('statusHelp');
    var button = document.getElementById('recheckBtn');

    function pill(kind, text) {
        if (!resultEl) { return; }
        resultEl.innerHTML = '<span class="pill ' + kind + '">' + text + '</span>';
    }

    function row(el, value) {
        if (el) { el.textContent = value; }
    }

    function run() {
        if (button) { button.disabled = true; }
        pill('wait', 'checking…');
        if (helpEl) { helpEl.classList.add('hidden'); }

        var endpoint = '';
        if (window.NEON_LEADS && window.NEON_LEADS.url) { endpoint = window.NEON_LEADS.url(); }
        row(endpointEl, endpoint ? endpoint.replace('/exec', '/exec') : 'not configured');

        if (!window.NEON_AUTH) {
            pill('bad', 'auth.js did not load');
            if (button) { button.disabled = false; }
            return;
        }

        window.NEON_AUTH.diagnose().then(function (res) {
            if (button) { button.disabled = false; }
            row(timeEl, new Date().toLocaleString());

            if (!res || !res.ok) {
                pill('bad', 'unreachable');
                if (res && res.error) { row(versionEl, res.error); }
                if (helpEl) { helpEl.classList.remove('hidden'); }
                return;
            }

            pill('ok', 'healthy');
            row(versionEl, 'v' + res.version + (res.spreadsheet ? ' · spreadsheet ' + res.spreadsheet : ''));
            var tabs = res.tabs || {};
            row(leadsEl, tabs.Leads === undefined ? '–' : tabs.Leads);
            row(usersEl, tabs.Users === undefined ? '–' : tabs.Users);
            row(sessionsEl, tabs.Sessions === undefined ? '–' : tabs.Sessions);
            if (res.problems && res.problems.length) {
                pill('bad', res.problems.join(', '));
                if (helpEl) { helpEl.classList.remove('hidden'); }
            }
        });
    }

    if (button) { button.addEventListener('click', run); }
    run();
})();
