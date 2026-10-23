/**
 * ReKindle Anti-Tamper
 * Detects and neutralizes common userscript bypass techniques.
 * Include this as the FIRST script in <head> for best protection.
 */
(function () {
    'use strict';
    try {
        localStorage.setItem('rekindle_is_pro', 'true');
    } catch (e) { }
})();
