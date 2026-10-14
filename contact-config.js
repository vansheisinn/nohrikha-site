// Public configuration only. Never put email credentials or secret API keys here.
// Owner confirmed the Free plan and enabled Formshield + CAPTCHA.
// Enabled in this review branch for live acceptance testing before merge.
// This flag records dashboard settings, not proof of end-to-end delivery.
window.NOHRIKHA_CONTACT = Object.freeze({
  enabled: true,
  provider: 'formspree',
  endpoint: 'https://formspree.io/f/xaeqlnpj',
  spamProtectionVerified: true
});
