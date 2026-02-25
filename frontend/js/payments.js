const Payments = {
    config: null,
    proStatus: { active: false, pro_expires_at: null },
    initialized: false,

    async init() {
        if (this.initialized) return;
        this.initialized = true;

        document.addEventListener('click', (event) => {
            const unlockBtn = event.target.closest('.btn-unlock-pro');
            if (!unlockBtn) return;
            event.preventDefault();
            this.startProCheckout();
        });

        try {
            this.config = await ChessAPI.getPaymentConfig();
            this._applyDynamicPricingLabels();
        } catch (error) {
            console.warn('Payment config unavailable:', error);
        }

        await this.refreshProStatus();
        this._prefillCoachingForm();
    },

    async refreshProStatus() {
        if (!Auth.isLoggedIn()) {
            this.proStatus = { active: false, pro_expires_at: null };
            this._renderProAccess();
            return this.proStatus;
        }
        try {
            this.proStatus = await ChessAPI.getProStatus();
        } catch (error) {
            this.proStatus = { active: false, pro_expires_at: null };
        }
        this._renderProAccess();
        this._prefillCoachingForm();
        return this.proStatus;
    },

    async startProCheckout() {
        if (!Auth.isLoggedIn()) {
            alert('Please log in first to unlock Pro.');
            Router.navigate('login');
            return;
        }
        if (!this._paymentsEnabled()) {
            alert('Payments are not configured yet. Add Razorpay keys on the server.');
            return;
        }

        try {
            const order = await ChessAPI.createPaymentOrder('pro_monthly');
            const user = Auth.getUser() || {};
            await this._openCheckout(order, {
                purpose: 'pro_monthly',
                name: user.username || 'Chess AI Coach User',
                email: user.email || '',
                contact: ''
            });
        } catch (error) {
            alert(error.message || 'Unable to start Pro checkout.');
        }
    },

    async startCoachingHourlyCheckout() {
        return this._startCoachingCheckout('hourly_1', '1 hour session');
    },

    async startCoachingMonthlyCheckout() {
        return this._startCoachingCheckout('monthly_10', '1 month pack (10 sessions)');
    },

    async _startCoachingCheckout(coachingPlan, planLabel) {
        if (!this._paymentsEnabled()) {
            this._setText('coachingPaymentStatus', 'Payments are not configured yet.');
            return;
        }

        const customer = this._readCoachingCustomerFromForm();
        if (!customer) return;

        this._setText('coachingPaymentStatus', `Creating secure payment order for ${planLabel}...`);
        try {
            const order = await ChessAPI.createPaymentOrder('coaching_booking', customer, coachingPlan);
            await this._openCheckout(order, {
                purpose: 'coaching_booking',
                name: customer.name,
                email: customer.email,
                contact: customer.phone,
                coachingPlan,
                planLabel
            });
        } catch (error) {
            this._setText('coachingPaymentStatus', error.message || 'Could not start coaching checkout.');
        }
    },

    async _openCheckout(order, prefill) {
        if (typeof window.Razorpay !== 'function') {
            throw new Error('Razorpay checkout failed to load.');
        }
        const options = {
            key: order.key_id,
            amount: order.amount_paise,
            currency: order.currency || 'INR',
            name: 'Chess AI Coach',
            description: order.purpose === 'pro_monthly'
                ? 'Pro Monthly Subscription'
                : (prefill.planLabel || 'Personal Coaching Booking'),
            order_id: order.order_id,
            prefill: {
                name: prefill.name || '',
                email: prefill.email || '',
                contact: prefill.contact || ''
            },
            notes: {
                purpose: order.purpose,
                coaching_plan: prefill.coachingPlan || ''
            },
            theme: {
                color: '#2b6cb0'
            },
            handler: async (response) => {
                try {
                    const verify = await ChessAPI.verifyPayment({
                        purpose: order.purpose,
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature
                    });
                    if (order.purpose === 'pro_monthly') {
                        await this.refreshProStatus();
                        alert(verify.message || 'Pro unlocked successfully.');
                    } else {
                        this._setText('coachingPaymentStatus', 'Payment received. We will contact you soon for scheduling.');
                    }
                } catch (error) {
                    if (order.purpose === 'coaching_booking') {
                        this._setText('coachingPaymentStatus', error.message || 'Payment verification failed.');
                    } else {
                        alert(error.message || 'Payment verification failed.');
                    }
                }
            }
        };

        const rz = new window.Razorpay(options);
        rz.on('payment.failed', (resp) => {
            const message = resp?.error?.description || 'Payment failed or cancelled.';
            if (order.purpose === 'coaching_booking') {
                this._setText('coachingPaymentStatus', message);
            } else {
                alert(message);
            }
        });
        rz.open();
    },

    _paymentsEnabled() {
        return !!(this.config && this.config.enabled && this.config.key_id);
    },

    _readCoachingCustomerFromForm() {
        const nameEl = document.getElementById('coachingName');
        const emailEl = document.getElementById('coachingEmail');
        const phoneEl = document.getElementById('coachingPhone');
        const goalsEl = document.getElementById('coachingGoals');

        const user = Auth.getUser() || {};
        const name = ((nameEl && nameEl.value) || user.username || '').trim();
        const email = ((emailEl && emailEl.value) || user.email || '').trim();
        const phone = ((phoneEl && phoneEl.value) || '').trim();
        const notes = ((goalsEl && goalsEl.value) || '').trim();

        if (!name || name.length < 2) {
            this._setText('coachingPaymentStatus', 'Please enter your full name.');
            return null;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this._setText('coachingPaymentStatus', 'Please enter a valid email.');
            return null;
        }
        if (!/^[0-9+\-\s()]{8,20}$/.test(phone)) {
            this._setText('coachingPaymentStatus', 'Please enter a valid phone/WhatsApp number.');
            return null;
        }
        return { name, email, phone, notes };
    },

    _applyDynamicPricingLabels() {
        const hourlyBtn = document.getElementById('bookCoachingHourlyBtn');
        const monthlyBtn = document.getElementById('bookCoachingMonthlyBtn');
        if (!this.config) return;
        if (hourlyBtn && this.config.coaching_hourly_amount_inr) {
            hourlyBtn.textContent = `Pay ₹${this.config.coaching_hourly_amount_inr} (1 Hour)`;
        }
        if (monthlyBtn && this.config.coaching_monthly_amount_inr) {
            monthlyBtn.textContent = `Pay ₹${this.config.coaching_monthly_amount_inr} (10 Sessions)`;
        }
    },

    _prefillCoachingForm() {
        const user = Auth.getUser() || {};
        const nameEl = document.getElementById('coachingName');
        const emailEl = document.getElementById('coachingEmail');
        if (nameEl && !nameEl.value && user.username) nameEl.value = user.username;
        if (emailEl && !emailEl.value && user.email) emailEl.value = user.email;
    },

    _renderProAccess() {
        const upsell = document.getElementById('proUpsell');
        const statusLine = document.getElementById('proStatusLine');
        const genBtn = document.getElementById('generateProPuzzlesBtn');

        if (!upsell || !genBtn) return;

        const active = !!this.proStatus.active;
        upsell.style.display = active ? 'none' : 'block';
        genBtn.disabled = !active;

        if (statusLine) {
            if (active && this.proStatus.pro_expires_at) {
                const d = new Date(this.proStatus.pro_expires_at);
                statusLine.textContent = `Pro active until ${d.toLocaleDateString()}.`;
            } else if (!Auth.isLoggedIn()) {
                statusLine.textContent = 'Log in, then unlock Pro for ₹50/month.';
            } else {
                statusLine.textContent = 'Unlock Pro to generate and solve mistake-based puzzles.';
            }
        }
    },

    _setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text || '';
    }
};

window.Payments = Payments;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Payments.init(), { once: true });
} else {
    Payments.init();
}
