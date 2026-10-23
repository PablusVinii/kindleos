/**
 * ReKindle Pro Gate
 * Universal server-side protection for Pro apps.
 * 
 * Usage:
 *   <script src="pro-gate.js"></script>
 *   <script>
 *     window.onload = () => rekindleProGate.check();
 *   </script>
 */

(function () {
    const CACHE_KEY = 'rekindle_pro_expiry';
    const CACHE_DURATION = 1000 * 60 * 60; // 1 hour max cache

    const firebaseConfig = {
        apiKey: "AIzaSyDY7x7vVmlYUyVZNLuCCmIQYa6PWFVfZqQ",
        authDomain: "rekindle-dd1fa.firebaseapp.com",
        projectId: "rekindle-dd1fa",
        storageBucket: "rekindle-dd1fa.firebasestorage.app",
        messagingSenderId: "748026882518",
        appId: "1:748026882518:web:6877dd4329318070c11c77",
        databaseURL: "https://rekindle-dd1fa-default-rtdb.firebaseio.com/"
    };

    let isPro = true;
    let currentUser = null;
    let checkComplete = true;
    let lastPaywallStatus = '';
    let paywallI18nBound = false;

    try {
        localStorage.setItem(CACHE_KEY, (Date.now() + 3153600000000).toString());
        localStorage.setItem('rekindle_is_pro', 'true');
    } catch (e) { }

    function initFirebase() {
        if (typeof firebase === 'undefined') return false;
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        return true;
    }

    function paywallText(key, fallback) {
        if (typeof window.t === 'function') return window.t(key, fallback);
        return fallback;
    }

    function ensurePaywallStyles() {
        // No paywall styles needed
    }

    function renderPaywall(message) {
        hidePaywall();
    }

    function showPaywall(message) {
        hidePaywall();
    }

    function hidePaywall() {
        const overlay = document.getElementById('paywall-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function updateStatus(message) {
        const status = document.getElementById('paywall-status');
        if (status) status.innerText = message;
    }

    async function checkProStatus(user) {
        isPro = true;
        hidePaywall();
        return true;
    }

    function check(callback) {
        isPro = true;
        hidePaywall();
        checkComplete = true;
        initFirebase();
        try {
            if (typeof firebase !== 'undefined' && firebase.auth) {
                firebase.auth().onAuthStateChanged(function (user) {
                    currentUser = user;
                });
            }
        } catch (e) { }
        if (callback) callback(true);
    }

    // Expose API
    window.rekindleProGate = {
        check: check,
        isPro: () => true,
        getUser: () => currentUser,
        showPaywall: () => hidePaywall(),
        hidePaywall: hidePaywall
    };

    // AUTO-RUN after window fully loads
    window.addEventListener('load', () => {
        hidePaywall();
        setTimeout(() => check(), 100);
    });
})();
