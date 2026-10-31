// ============================================================
//  Password reset page – reads ?email=&token= from the reset email
//  and hands them to NEON_AUTH.resetPassword().
// ============================================================
(function () {
    'use strict';

    var params = new URLSearchParams(window.location.search);
    var email = params.get('email') || '';
    var token = params.get('token') || '';
    var form = document.getElementById('resetForm');
    var message = document.getElementById('resetMessage');
    var submit = document.getElementById('resetSubmit');
    var intro = document.getElementById('resetIntro');

    function say(text, ok) {
        if (!message) { return; }
        message.innerHTML = '<span style="color:' + (ok ? '#1e6f3f' : '#b91c1c') + ';">' +
            (ok ? '✅ ' : '❌ ') + text + '</span>';
    }

    if (email) { document.getElementById('resetEmail').value = email; }
    if (!token) {
        say('This page needs the link from your reset email. Request a new one from the sign-in page.', false);
        if (intro) { intro.textContent = 'No reset token found in this link.'; }
    }

    if (!form) { return; }
    form.addEventListener('submit', function (event) {
        event.preventDefault();
        var emailValue = document.getElementById('resetEmail').value.trim();
        var next = document.getElementById('resetNewPassword').value;
        var confirm = document.getElementById('resetConfirmPassword').value;

        if (!token) { say('Open the link from your reset email first.', false); return; }
        if (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
            say('The password needs at least 8 characters, including a letter and a number.', false);
            return;
        }
        if (next !== confirm) { say('The passwords do not match.', false); return; }
        if (!window.NEON_AUTH) { say('Accounts are not connected yet.', false); return; }

        submit.disabled = true;
        submit.textContent = 'Saving…';
        window.NEON_AUTH.resetPassword({
            email: emailValue, resetToken: token, newPassword: next
        }).then(function (res) {
            submit.disabled = false;
            submit.textContent = 'Set new password →';
            if (res && res.ok) {
                form.reset();
                say('Password updated. Taking you to the sign-in page…', true);
                setTimeout(function () { window.location.href = 'profile.html'; }, 1800);
                return;
            }
            say((res && res.error) || 'We could not update your password. Please request a new link.', false);
        });
    });
})();
