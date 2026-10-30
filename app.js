// ============================================================
//  MAIN – runs once when DOM is ready
// ============================================================
document.addEventListener('DOMContentLoaded', function() {

    // ============================================================
    //  1. MOBILE NAV TOGGLES (Top Nav + Sidebar)
    // ============================================================

    // --- Top nav toggle ---
    const menuBtnTop = document.getElementById('menuToggleTop');
    const topNav = document.getElementById('topNav');

    if (menuBtnTop && topNav) {
        menuBtnTop.addEventListener('click', function(e) {
            e.stopPropagation();
            topNav.classList.toggle('show');
        });

        // Close top nav when a link is clicked (good UX on mobile)
        const navLinks = topNav.querySelectorAll('a');
        navLinks.forEach(function(link) {
            link.addEventListener('click', function() {
                if (topNav.classList.contains('show')) {
                    topNav.classList.remove('show');
                }
            });
        });
    }

    // --- Sidebar toggle ---
    const menuBtnSide = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');

    if (menuBtnSide && sidebar) {
        menuBtnSide.addEventListener('click', function(e) {
            e.stopPropagation();
            sidebar.classList.toggle('open');
        });

        // Close sidebar when a link is clicked (prevents "stuck" on mobile)
        const sidebarLinks = sidebar.querySelectorAll('a');
        sidebarLinks.forEach(function(link) {
            link.addEventListener('click', function() {
                if (sidebar.classList.contains('open')) {
                    sidebar.classList.remove('open');
                }
            });
        });

        // Close sidebar if user clicks outside on mobile
        document.addEventListener('click', function(e) {
            if (sidebar.classList.contains('open')) {
                // Check if click is outside sidebar and not on the toggle button
                if (!sidebar.contains(e.target) && e.target.id !== 'menuToggle') {
                    sidebar.classList.remove('open');
                }
            }
        });
    }

    // ============================================================
    //  2. ALL EXISTING FUNCTIONALITY (profile, partners, etc.)
    //     Keep the rest of your code exactly as it was,
    //     but make sure there are no nested DOMContentLoaded listeners.
    // ============================================================

    // --- Profile Page Tabs ---
    const loginTab = document.getElementById('loginTab');
    const signupTab = document.getElementById('signupTab');
    const loginDiv = document.getElementById('loginForm');
    const signupDiv = document.getElementById('signupForm');

    if (loginTab && signupTab && loginDiv && signupDiv) {
        loginTab.addEventListener('click', function() {
            loginTab.classList.add('active');
            signupTab.classList.remove('active');
            loginDiv.style.display = 'block';
            signupDiv.style.display = 'none';
        });
        signupTab.addEventListener('click', function() {
            signupTab.classList.add('active');
            loginTab.classList.remove('active');
            signupDiv.style.display = 'block';
            loginDiv.style.display = 'none';
        });

        // Login form mock
        const loginForm = document.getElementById('loginFormElement');
        if (loginForm) {
            loginForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const email = document.getElementById('loginEmail').value;
                const pwd = document.getElementById('loginPassword').value;
                const msg = document.getElementById('loginMessage');
                if (email && pwd) {
                    msg.innerHTML = '<span style="color:green;">✅ Login successful (demo). Backend will be connected soon.</span>';
                } else {
                    msg.innerHTML = '<span style="color:red;">❌ Please enter both email and password.</span>';
                }
            });
        }

        // Signup form mock
        const signupForm = document.getElementById('signupFormElement');
        if (signupForm) {
            signupForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const name = document.getElementById('signupName').value;
                const email = document.getElementById('signupEmail').value;
                const pwd = document.getElementById('signupPassword').value;
                const confirm = document.getElementById('signupConfirmPassword').value;
                const msg = document.getElementById('signupMessage');
                if (!name || !email || !pwd) {
                    msg.innerHTML = '<span style="color:red;">❌ Please fill all required fields.</span>';
                    return;
                }
                if (pwd !== confirm) {
                    msg.innerHTML = '<span style="color:red;">❌ Passwords do not match.</span>';
                    return;
                }
                msg.innerHTML = '<span style="color:green;">✅ Account created! Please check your email for confirmation. (Demo – backend pending)</span>';
            });
        }

        // Google login placeholder
        const googleBtn = document.getElementById('googleLoginBtn');
        if (googleBtn) {
            googleBtn.addEventListener('click', function() {
                alert('Google Sign‑in will be integrated later using OAuth.');
            });
        }
    }

    // ============================================================
    //  3. PARTNERS PAGE – Dynamic forms
    // ============================================================
    const partnerType = document.getElementById('partnerType');
    const dynamicForm = document.getElementById('dynamicForm');
    const submitPartnerBtn = document.getElementById('submitPartnerBtn');
    const partnerSubmitMsg = document.getElementById('submitMessage');
    const partnerLoginWarning = document.getElementById('loginWarning');

    if (partnerType && dynamicForm) {
        let isLoggedIn = false; // demo

        if (partnerLoginWarning) {
            isLoggedIn ? partnerLoginWarning.classList.add('hidden') : partnerLoginWarning.classList.remove('hidden');
        }

        const partnerForms = {
            legal: `
                <div class="form-group"><label for="legalName">Full name / Firm name</label><input type="text" id="legalName" placeholder="e.g., John Doe Attorneys" required></div>
                <div class="form-group"><label for="legalRegNo">Professional registration number (e.g., LPC / Fidelity Fund)</label><input type="text" id="legalRegNo" required></div>
                <div class="form-group"><label for="legalExp">Years of experience</label><input type="number" id="legalExp" required></div>
                <div class="form-group"><label for="legalCert">Upload your certificate / practising licence (PDF)</label><input type="file" id="legalCert" accept=".pdf,.jpg,.png"></div>
                <div class="form-group"><label for="legalBio">Short bio</label><textarea id="legalBio" rows="3" placeholder="Describe your practice areas"></textarea></div>
            `,
            accounting: `
                <div class="form-group"><label for="accName">Full name / Firm name</label><input type="text" id="accName" placeholder="e.g., ABC Accountants" required></div>
                <div class="form-group"><label for="accRegNo">SAICA / SAIPA registration number</label><input type="text" id="accRegNo" required></div>
                <div class="form-group"><label for="accExp">Years of experience</label><input type="number" id="accExp" required></div>
                <div class="form-group"><label for="accCert">Upload your practising certificate (PDF)</label><input type="file" id="accCert" accept=".pdf,.jpg,.png"></div>
                <div class="form-group"><label for="accServices">Services offered</label><textarea id="accServices" rows="3" placeholder="e.g., tax, bookkeeping, financial statements"></textarea></div>
            `,
            audit: `
                <div class="form-group"><label for="auditName">Full name / Firm name</label><input type="text" id="auditName" required></div>
                <div class="form-group"><label for="auditRegNo">IRBA registration number</label><input type="text" id="auditRegNo" required></div>
                <div class="form-group"><label for="auditExp">Years of experience</label><input type="number" id="auditExp" required></div>
                <div class="form-group"><label for="auditCert">Upload your audit firm certificate (PDF)</label><input type="file" id="auditCert" accept=".pdf,.jpg,.png"></div>
                <div class="form-group"><label for="auditIndustries">Industries you specialise in</label><textarea id="auditIndustries" rows="2"></textarea></div>
            `,
            tax: `
                <div class="form-group"><label for="taxName">Full name / Firm name</label><input type="text" id="taxName" required></div>
                <div class="form-group"><label for="taxRegNo">SARS registered tax practitioner number</label><input type="text" id="taxRegNo" required></div>
                <div class="form-group"><label for="taxExp">Years of experience</label><input type="number" id="taxExp" required></div>
                <div class="form-group"><label for="taxCert">Upload your tax practitioner certificate (PDF)</label><input type="file" id="taxCert" accept=".pdf,.jpg,.png"></div>
                <div class="form-group"><label for="taxAreas">Areas of expertise</label><textarea id="taxAreas" rows="2"></textarea></div>
            `,
            business: `
                <div class="form-group"><label for="businessName">Your name / Business name</label><input type="text" id="businessName" required></div>
                <div class="form-group"><label for="businessReg">Business registration number (if any)</label><input type="text" id="businessReg"></div>
                <div class="form-group"><label for="businessDesc">Describe your business / venture idea</label><textarea id="businessDesc" rows="4" required></textarea></div>
                <div class="form-group"><label for="businessPartnership">What kind of partnership are you seeking?</label><textarea id="businessPartnership" rows="2" placeholder="e.g., joint venture, capital investment, skills exchange"></textarea></div>
                <div class="form-group"><label for="businessFile">Upload business profile / pitch deck (optional)</label><input type="file" id="businessFile" accept=".pdf,.pptx,.docx"></div>
            `
        };

        function loadPartnerForm() {
            dynamicForm.innerHTML = partnerForms[partnerType.value] || '';
        }
        loadPartnerForm();
        partnerType.addEventListener('change', loadPartnerForm);

        if (submitPartnerBtn) {
            submitPartnerBtn.addEventListener('click', function() {
                if (!isLoggedIn) {
                    partnerSubmitMsg.innerHTML = '<span style="color:red;">❌ Please <a href="profile.html">log in</a> to submit a partnership application.</span>';
                    return;
                }
                partnerSubmitMsg.innerHTML = '<span style="color:green;">✅ Application received! Our team will review and contact you within 5 business days. (Demo – backend pending)</span>';
            });
        }
    }

    // ============================================================
    //  4. INTERNATIONAL PAGE – Dynamic forms
    // ============================================================
    const entityType = document.getElementById('entityType');
    const intlDynamicForm = document.getElementById('dynamicForm');
    const intlSubmitBtn = document.getElementById('submitInternationalBtn');
    const intlSubmitMsg = document.getElementById('submitMessage');
    const intlLoginWarning = document.getElementById('loginWarning');

    if (entityType && intlDynamicForm) {
        let isLoggedIn = false;
        if (intlLoginWarning) {
            isLoggedIn ? intlLoginWarning.classList.add('hidden') : intlLoginWarning.classList.remove('hidden');
        }

        const intlForms = {
            individual: `
                <div class="form-group"><label for="indName">Full name</label><input type="text" id="indName" required></div>
                <div class="form-group"><label for="indEmail">Email address</label><input type="email" id="indEmail" required></div>
                <div class="form-group"><label for="indPhone">Phone (with country code)</label><input type="tel" id="indPhone" required></div>
                <div class="form-group"><label for="indCountry">Country of residence / incorporation</label><input type="text" id="indCountry" required></div>
                <div class="form-group"><label for="indNeeds">What services do you need? (Registration, tax, compliance, etc.)</label><textarea id="indNeeds" rows="3" required></textarea></div>
                <div class="form-group"><label for="indFile">Upload passport / ID copy (PDF, JPG)</label><input type="file" id="indFile" accept=".pdf,.jpg,.png"></div>
                <div class="file-hint">Optional – you can upload supporting documents.</div>
            `,
            company: `
                <div class="form-group"><label for="compName">Company name</label><input type="text" id="compName" required></div>
                <div class="form-group"><label for="compRegNo">Registration number (in home country)</label><input type="text" id="compRegNo" required></div>
                <div class="form-group"><label for="compCountry">Country of incorporation</label><input type="text" id="compCountry" required></div>
                <div class="form-group"><label for="compContactPerson">Contact person</label><input type="text" id="compContactPerson" required></div>
                <div class="form-group"><label for="compEmail">Email address</label><input type="email" id="compEmail" required></div>
                <div class="form-group"><label for="compNeeds">What South African services do you need?</label><textarea id="compNeeds" rows="3" placeholder="e.g., company registration, tax clearance, B-BBEE, payroll"></textarea></div>
                <div class="form-group"><label for="compFile">Upload certificate of incorporation / company profile (PDF)</label><input type="file" id="compFile" accept=".pdf,.jpg,.png"></div>
                <div class="file-hint">Optional – helps us understand your structure.</div>
            `
        };

        function loadIntlForm() {
            intlDynamicForm.innerHTML = intlForms[entityType.value] || '';
        }
        loadIntlForm();
        entityType.addEventListener('change', loadIntlForm);

        if (intlSubmitBtn) {
            intlSubmitBtn.addEventListener('click', function() {
                if (!isLoggedIn) {
                    intlSubmitMsg.innerHTML = '<span style="color:red;">❌ Please <a href="profile.html">log in</a> to submit an international partnership request.</span>';
                    return;
                }
                intlSubmitMsg.innerHTML = '<span style="color:green;">✅ Thank you! Your international request has been received. We will contact you within 48 hours. (Demo – backend pending)</span>';
            });
        }
    }

    // ============================================================
    //  5. STRATEGIC GROWTH PAGE – Form
    // ============================================================
    const growthForm = document.getElementById('growthForm');
    const growthSubmitMsg = document.getElementById('submitMessage');
    const growthLoginWarning = document.getElementById('loginWarning');

    if (growthForm) {
        let isLoggedIn = false;
        if (growthLoginWarning) {
            isLoggedIn ? growthLoginWarning.classList.add('hidden') : growthLoginWarning.classList.remove('hidden');
        }

        const appointmentDate = document.getElementById('appointmentDate');
        if (appointmentDate) {
            const today = new Date();
            const minDate = new Date(today);
            minDate.setDate(today.getDate() + 7);
            appointmentDate.setAttribute('min', minDate.toISOString().split('T')[0]);
        }

        growthForm.addEventListener('submit', function(e) {
            e.preventDefault();
            if (!isLoggedIn) {
                growthSubmitMsg.innerHTML = '<span style="color:red;">❌ Please <a href="profile.html">log in</a> to book a strategic growth session.</span>';
                return;
            }
            const selectedDate = document.getElementById('appointmentDate').value;
            if (!selectedDate) {
                growthSubmitMsg.innerHTML = '<span style="color:red;">❌ Please select a preferred date (at least 7 days from now).</span>';
                return;
            }
            growthSubmitMsg.innerHTML = '<span style="color:green;">✅ Your strategic growth consultation request has been received! We will confirm your appointment within 48 hours. (Demo – backend pending)</span>';
        });
    }

    // ============================================================
    //  6. BUSINESS PARTNERS PAGE – Director Session & Partner App
    // ============================================================
    const directorForm = document.getElementById('directorSessionForm');
    const partnerAppForm = document.getElementById('partnerApplicationForm');
    const partnerListEl = document.getElementById('partnerList');

    if (directorForm || partnerAppForm) {
        let isLoggedIn = false;

        function updateBusinessWarnings() {
            document.querySelectorAll('.login-warning').forEach(w => {
                isLoggedIn ? w.classList.add('hidden') : w.classList.remove('hidden');
            });
        }
        updateBusinessWarnings();

        // Director session date min (14 days)
        const sessionDateInput = document.getElementById('sessionDate');
        if (sessionDateInput) {
            const today = new Date();
            const minDate = new Date(today);
            minDate.setDate(today.getDate() + 14);
            sessionDateInput.setAttribute('min', minDate.toISOString().split('T')[0]);
        }

        if (directorForm) {
            directorForm.addEventListener('submit', function(e) {
                e.preventDefault();
                if (!isLoggedIn) {
                    document.getElementById('sessionMessage').innerHTML = '<span style="color:red;">❌ Please <a href="profile.html">log in</a> to book a session.</span>';
                    return;
                }
                const selectedDate = document.getElementById('sessionDate').value;
                if (!selectedDate) {
                    document.getElementById('sessionMessage').innerHTML = '<span style="color:red;">❌ Please select a date at least 14 days from now.</span>';
                    return;
                }
                document.getElementById('sessionMessage').innerHTML = '<span style="color:green;">✅ Director session request received! We will confirm within 48 hours. (Demo)</span>';
            });
        }

        // Partner application + dynamic list
        let partners = [];
        if (partnerAppForm) {
            partnerAppForm.addEventListener('submit', function(e) {
                e.preventDefault();
                if (!isLoggedIn) {
                    document.getElementById('partnerApplicationMessage').innerHTML = '<span style="color:red;">❌ Please <a href="profile.html">log in</a> to apply.</span>';
                    return;
                }
                const companyName = document.getElementById('partnerCompanyName').value;
                const industry = document.getElementById('partnerIndustry').value;
                const website = document.getElementById('partnerWebsite').value;
                const description = document.getElementById('partnerDescription').value;
                const logoFile = document.getElementById('partnerLogo').files[0];

                if (!companyName || !industry || !description) {
                    document.getElementById('partnerApplicationMessage').innerHTML = '<span style="color:red;">❌ Please fill in all required fields.</span>';
                    return;
                }

                const reader = new FileReader();
                reader.onload = function(evt) {
                    const logoData = evt.target.result || null;
                    partners.push({ companyName, industry, website, description, logoData });
                    renderPartners();
                    document.getElementById('partnerApplicationMessage').innerHTML = '<span style="color:green;">✅ Application submitted! Your business now appears in Prospective Partners. (Demo)</span>';
                    partnerAppForm.reset();
                };
                if (logoFile) {
                    reader.readAsDataURL(logoFile);
                } else {
                    partners.push({ companyName, industry, website, description, logoData: null });
                    renderPartners();
                    document.getElementById('partnerApplicationMessage').innerHTML = '<span style="color:green;">✅ Application submitted! Your business now appears in Prospective Partners. (Demo)</span>';
                    partnerAppForm.reset();
                }
            });
        }

        function renderPartners() {
            if (!partnerListEl) return;
            if (partners.length === 0) {
                partnerListEl.innerHTML = '<p>No prospective partners yet. Be the first to apply!</p>';
                return;
            }
            partnerListEl.innerHTML = '';
            partners.forEach(p => {
                const card = document.createElement('div');
                card.className = 'partner-card';
                const logoHtml = p.logoData ? `<img src="${p.logoData}" alt="Logo">` : `<i class="fas fa-building" style="font-size:3rem; color:#fbbf24;"></i>`;
                card.innerHTML = `
                    ${logoHtml}
                    <h4>${p.companyName}</h4>
                    <p>${p.industry}</p>
                    <a href="#" class="btn-small">Order Service →</a>
                `;
                partnerListEl.appendChild(card);
            });
        }
        renderPartners();
    }

    // ============================================================
    //  7. MARKET LEADS PAGE – Consent + Company DB
    // ============================================================
    const marketLoginWarning = document.getElementById('loginWarning');
    const dataConsentSection = document.getElementById('dataConsentSection');
    const databaseSection = document.getElementById('databaseSection');
    const agreeBtn = document.getElementById('agreeBtn');
    const consentCheckbox = document.getElementById('dataConsent');
    const companyListEl = document.getElementById('companyList');
    const regForm = document.getElementById('registerCompanyForm');

    if (marketLoginWarning || dataConsentSection || databaseSection) {
        let isLoggedIn = false;
        let companies = [];

        // Load from localStorage
        if (localStorage.getItem('marketCompanies')) {
            try {
                companies = JSON.parse(localStorage.getItem('marketCompanies'));
            } catch (e) { /* ignore */ }
        } else {
            companies = [
                { name: "ABC Logistics", industry: "Logistics", services: "Freight & courier services", logoData: null },
                { name: "CleanCo", industry: "Cleaning", services: "Office & industrial cleaning", logoData: null },
                { name: "Steel Masters", industry: "Manufacturing", services: "Steel fabrication", logoData: null }
            ];
            localStorage.setItem('marketCompanies', JSON.stringify(companies));
        }

        function renderCompanies() {
            if (!companyListEl) return;
            if (companies.length === 0) {
                companyListEl.innerHTML = '<p>No companies yet. Be the first to register!</p>';
                return;
            }
            companyListEl.innerHTML = '';
            companies.forEach(comp => {
                const card = document.createElement('div');
                card.className = 'company-card';
                let logoHtml = '';
                if (comp.logoData) {
                    logoHtml = `<img src="${comp.logoData}" alt="Logo">`;
                } else {
                    logoHtml = `<div class="company-logo"><i class="fas fa-building"></i></div>`;
                }
                card.innerHTML = `
                    ${logoHtml}
                    <h3>${comp.name}</h3>
                    <div class="industry">${comp.industry}</div>
                    <p>${comp.services}</p>
                    <a href="#" class="btn-small">Order Service →</a>
                `;
                companyListEl.appendChild(card);
            });
        }

        function updateMarketUI() {
            if (!isLoggedIn) {
                marketLoginWarning.classList.remove('hidden');
                dataConsentSection.classList.add('hidden');
                databaseSection.classList.add('hidden');
                return;
            }
            marketLoginWarning.classList.add('hidden');
            const hasAgreed = localStorage.getItem('marketConsent') === 'true';
            if (hasAgreed) {
                dataConsentSection.classList.add('hidden');
                databaseSection.classList.remove('hidden');
                renderCompanies();
            } else {
                dataConsentSection.classList.remove('hidden');
                databaseSection.classList.add('hidden');
            }
        }

        if (agreeBtn) {
            agreeBtn.addEventListener('click', function() {
                if (!consentCheckbox.checked) {
                    alert('You must agree to the data sharing policy to access the database.');
                    return;
                }
                localStorage.setItem('marketConsent', 'true');
                dataConsentSection.classList.add('hidden');
                databaseSection.classList.remove('hidden');
                renderCompanies();
            });
        }

        if (regForm) {
            regForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const name = document.getElementById('regCompanyName').value.trim();
                const industry = document.getElementById('regIndustry').value.trim();
                const services = document.getElementById('regServices').value.trim();
                const logoFile = document.getElementById('regLogo').files[0];
                const msg = document.getElementById('regMessage');

                if (!name || !industry || !services) {
                    msg.innerHTML = '<span style="color:red;">❌ Please fill in all required fields.</span>';
                    return;
                }

                const reader = new FileReader();
                reader.onload = function(evt) {
                    const logoData = evt.target.result || null;
                    companies.push({ name, industry, services, logoData });
                    localStorage.setItem('marketCompanies', JSON.stringify(companies));
                    renderCompanies();
                    msg.innerHTML = '<span style="color:green;">✅ Company registered and now appears in the database!</span>';
                    regForm.reset();
                };
                if (logoFile) {
                    reader.readAsDataURL(logoFile);
                } else {
                    companies.push({ name, industry, services, logoData: null });
                    localStorage.setItem('marketCompanies', JSON.stringify(companies));
                    renderCompanies();
                    msg.innerHTML = '<span style="color:green;">✅ Company registered and now appears in the database!</span>';
                    regForm.reset();
                }
            });
        }

        updateMarketUI();
    }

    // ============================================================
    //  8. BUSINESS HUB PAGE – Comments
    // ============================================================
    const hubLoginWarning = document.getElementById('loginWarning');
    const commentArea = document.getElementById('commentArea');
    const commentList = document.getElementById('commentList');
    const postBtn = document.getElementById('postCommentBtn');
    const newCommentInput = document.getElementById('newComment');

    if (hubLoginWarning || commentArea) {
        let isLoggedIn = false;
        let comments = [];

        function loadComments() {
            const stored = localStorage.getItem('hubComments');
            if (stored) {
                try {
                    comments = JSON.parse(stored);
                } catch (e) {
                    comments = getDefaultComments();
                }
            } else {
                comments = getDefaultComments();
                localStorage.setItem('hubComments', JSON.stringify(comments));
            }
            renderComments();
        }

        function getDefaultComments() {
            return [
                { author: "Mzolisi", date: new Date().toLocaleString(), text: "Excited about this new platform!" },
                { author: "Thabo", date: new Date().toLocaleString(), text: "When is the next live session?" }
            ];
        }

        function renderComments() {
            if (!commentList) return;
            if (comments.length === 0) {
                commentList.innerHTML = '<p>No comments yet. Be the first to post!</p>';
                return;
            }
            commentList.innerHTML = '';
            comments.forEach(comm => {
                const div = document.createElement('div');
                div.className = 'comment-item';
                div.innerHTML = `
                    <div><span class="comment-author">${escapeHtml(comm.author)}</span><span class="comment-date">${comm.date}</span></div>
                    <div class="comment-text">${escapeHtml(comm.text)}</div>
                `;
                commentList.appendChild(div);
            });
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/[&<>]/g, function(m) {
                if (m === '&') return '&amp;';
                if (m === '<') return '&lt;';
                if (m === '>') return '&gt;';
                return m;
            });
        }

        function updateHubUI() {
            if (!isLoggedIn) {
                hubLoginWarning.classList.remove('hidden');
                commentArea.classList.add('hidden');
            } else {
                hubLoginWarning.classList.add('hidden');
                commentArea.classList.remove('hidden');
                loadComments();
            }
        }

        if (postBtn) {
            postBtn.addEventListener('click', function() {
                if (!isLoggedIn) {
                    alert('Please log in to comment.');
                    return;
                }
                const newText = newCommentInput.value.trim();
                if (!newText) {
                    alert('Please enter a comment.');
                    return;
                }
                const comment = {
                    author: "LoggedInUser",
                    date: new Date().toLocaleString(),
                    text: newText
                };
                comments.push(comment);
                localStorage.setItem('hubComments', JSON.stringify(comments));
                renderComments();
                newCommentInput.value = '';
            });
        }

        updateHubUI();
    }

    // ============================================================
    //  9. HIRE ADMIN PAGE – Form
    // ============================================================
    const hireAdminForm = document.getElementById('hireAdminForm');
    const hireLoginWarning = document.getElementById('loginWarning');
    const hireSubmitMsg = document.getElementById('submitMessage');
    const startDateInput = document.getElementById('startDate');

    if (hireAdminForm) {
        let isLoggedIn = false;
        if (hireLoginWarning) {
            isLoggedIn ? hireLoginWarning.classList.add('hidden') : hireLoginWarning.classList.remove('hidden');
        }

        if (startDateInput) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            startDateInput.setAttribute('min', tomorrow.toISOString().split('T')[0]);
        }

        hireAdminForm.addEventListener('submit', function(e) {
            e.preventDefault();
            if (!isLoggedIn) {
                hireSubmitMsg.innerHTML = '<span style="color:red;">❌ Please <a href="profile.html">log in</a> to submit a request.</span>';
                return;
            }
            const contractLength = document.querySelector('input[name="contractLength"]:checked');
            if (!contractLength) {
                hireSubmitMsg.innerHTML = '<span style="color:red;">❌ Please select a contract length.</span>';
                return;
            }
            const staffCount = document.getElementById('staffCount').value;
            if (staffCount < 1) {
                hireSubmitMsg.innerHTML = '<span style="color:red;">❌ Please enter a valid number of staff.</span>';
                return;
            }
            hireSubmitMsg.innerHTML = '<span style="color:green;">✅ Your request has been received! Our team will contact you within 48 hours to discuss a custom SLA. (Demo – backend pending)</span>';
        });
    }

    // ============================================================
    //  10. REFERRAL PAGE – Stats, Link, Simulation
    // ============================================================
    const refLoginWarning = document.getElementById('loginWarning');
    const refContent = document.getElementById('referralContent');
    const totalReferralsEl = document.getElementById('totalReferrals');
    const totalEarningsEl = document.getElementById('totalEarnings');
    const pendingEarningsEl = document.getElementById('pendingEarnings');
    const referralLinkEl = document.getElementById('referralLink');
    const copyBtn = document.getElementById('copyLinkBtn');
    const refreshBtn = document.getElementById('refreshLinkBtn');
    const historyDiv = document.getElementById('referralHistory');
    const simulateAmount = document.getElementById('simulateAmount');
    const simulateBtn = document.getElementById('simulatePurchaseBtn');

    if (refLoginWarning && refContent) {
        let isLoggedIn = false;
        let referralData = { referralCode: '', referrals: [], totalEarned: 0 };

        function initReferralData() {
            const stored = localStorage.getItem('legacyReferral');
            if (stored) {
                try {
                    referralData = JSON.parse(stored);
                } catch (e) {
                    generateNewCode();
                }
            } else {
                generateNewCode();
            }
            updateReferralUI();
        }

        function generateNewCode() {
            referralData.referralCode = 'REF' + Math.random().toString(36).substring(2, 8).toUpperCase();
            referralData.referrals = [];
            referralData.totalEarned = 0;
            localStorage.setItem('legacyReferral', JSON.stringify(referralData));
        }

        function updateReferralUI() {
            if (totalReferralsEl) totalReferralsEl.innerText = referralData.referrals.length;
            if (totalEarningsEl) totalEarningsEl.innerText = 'R' + referralData.totalEarned;
            if (pendingEarningsEl) pendingEarningsEl.innerText = 'R0';

            if (referralLinkEl) {
                const base = window.location.origin + window.location.pathname.replace('referral.html', '') + '?ref=';
                referralLinkEl.innerText = base + referralData.referralCode;
            }

            if (historyDiv) {
                if (referralData.referrals.length === 0) {
                    historyDiv.innerHTML = '<p>No referrals yet. Share your link to get started!</p>';
                } else {
                    let html = '<ul class="referral-history-list">';
                    referralData.referrals.forEach(ref => {
                        html += `<li class="referral-history-item">
                                    <strong>${escapeHtml(ref.referredEmail) || 'Anonymous'}</strong> – Spent R${ref.purchaseAmount} → Earned R${ref.earnings}<br>
                                    <small>${ref.date}</small>
                                </li>`;
                    });
                    html += '</ul>';
                    historyDiv.innerHTML = html;
                }
            }
        }

        function addReferral(email, amount) {
            const earnings = amount * 0.1;
            referralData.referrals.push({
                referredEmail: email || 'Guest',
                purchaseAmount: amount,
                earnings: Math.round(earnings * 100) / 100,
                date: new Date().toLocaleString(),
                status: 'completed'
            });
            referralData.totalEarned += earnings;
            localStorage.setItem('legacyReferral', JSON.stringify(referralData));
            updateReferralUI();
        }

        function showToast(message, type) {
            let container = document.getElementById('toastContainer');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toastContainer';
                container.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:10px; max-width:350px;';
                document.body.appendChild(container);
            }
            const toast = document.createElement('div');
            const bgColor = type === 'success' ? '#10b981' : '#ef4444';
            toast.style.cssText = `
                background: ${bgColor};
                color: white;
                padding: 12px 20px;
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                animation: slideIn 0.3s ease;
                font-family: 'Segoe UI', sans-serif;
                font-size: 0.9rem;
            `;
            toast.innerText = message;
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // Ensure animation style exists
        if (!document.getElementById('toastStyles')) {
            const style = document.createElement('style');
            style.id = 'toastStyles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        function updateRefVisibility() {
            if (!isLoggedIn) {
                refLoginWarning.classList.remove('hidden');
                refContent.classList.add('hidden');
            } else {
                refLoginWarning.classList.add('hidden');
                refContent.classList.remove('hidden');
                initReferralData();
            }
        }

        // Copy link
        if (copyBtn) {
            copyBtn.addEventListener('click', function() {
                const linkText = referralLinkEl.innerText;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(linkText).then(() => {
                        showToast('Referral link copied!', 'success');
                    }).catch(() => fallbackCopy(linkText));
                } else {
                    fallbackCopy(linkText);
                }
            });
        }

        function fallbackCopy(text) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('Referral link copied!', 'success');
            } catch (e) {
                alert('Could not copy. Please select and copy manually.');
            }
            document.body.removeChild(textarea);
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                if (confirm('Generating a new link will invalidate the old one. Continue?')) {
                    generateNewCode();
                    updateReferralUI();
                    showToast('New referral link generated!', 'success');
                }
            });
        }

        if (simulateBtn && simulateAmount) {
            simulateBtn.addEventListener('click', function() {
                const amount = parseFloat(simulateAmount.value);
                if (isNaN(amount) || amount < 1000) {
                    showToast('Please enter a valid amount of R1,000 or more.', 'error');
                    return;
                }
                addReferral('Simulated User', amount);
                simulateAmount.value = '';
                showToast(`Referral recorded! Earned R${(amount * 0.1).toFixed(2)}.`, 'success');
            });
        }

        updateRefVisibility();
    }

}); // end DOMContentLoaded
