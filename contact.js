/* Native POST deliberately leaves CAPTCHA and delivery confirmation to the
 * approved processor. This page never claims that a message was delivered. */
(() => {
  'use strict';
  const form = document.querySelector('#feedback-form');
  if (!form) return;
  const lang = document.documentElement.lang;
  const copy = {
    ru: {
      privacy: 'Сообщение, имя и email передаются Formspree для рассмотрения обращения и ответа. Сообщения не публикуются автоматически. Политика конфиденциальности',
      requiredName: 'Укажите имя.',
      invalid: 'Введите от 20 до 10 000 символов, не считая пробелов по краям.',
      blocked: 'Отправка заблокирована проверкой формы. Проверьте заполнение полей.',
      sending: 'Открываем страницу отправки…'
    },
    en: {
      privacy: 'Your message, name and email are sent to Formspree to review and reply to your enquiry. Messages are not published automatically. Privacy policy',
      requiredName: 'Enter your name.',
      invalid: 'Enter 20 to 10,000 characters, excluding leading and trailing whitespace.',
      blocked: 'Submission was blocked by a form check. Check the fields.',
      sending: 'Opening the submission page…'
    },
  }[lang] || null;
  const config = window.NOHRIKHA_CONTACT;
  // The endpoint is public, not a credential. Restrict where visitor data can go.
  const configured = copy && config && config.enabled === true &&
    config.provider === 'formspree' && config.spamProtectionVerified === true &&
    typeof config.endpoint === 'string' &&
    /^https:\/\/formspree\.io\/f\/[A-Za-z0-9]+$/.test(config.endpoint);
  if (!configured) return; // Static fieldset remains disabled, including without JS.
  const fieldset = form.querySelector('fieldset');
  const status = document.querySelector('#feedback-status');
  const message = form.elements.namedItem('message');
  const contactName = form.elements.namedItem('name');
  const trap = form.elements.namedItem('_gotcha');
  const submit = form.querySelector('button[type="submit"]');
  let sending = false;
  form.action = config.endpoint;
  fieldset.disabled = false;
  document.querySelector('#feedback-availability').hidden = true;
  const privacy = document.querySelector('#feedback-privacy');
  privacy.textContent = copy.privacy + ': ';
  const link = document.createElement('a');
  link.href = 'https://formspree.io/legal/privacy-policy/';
  link.textContent = 'formspree.io';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  privacy.append(link);
  message.addEventListener('input', () => message.setCustomValidity(''));
  contactName.addEventListener('input', () => contactName.setCustomValidity(''));
  // Returning true invokes the browser's native HTTPS POST, including server CAPTCHA.
  form.onsubmit = () => {
    if (sending) return false;
    if (trap.value.trim()) {
      status.textContent = copy.blocked;
      return false;
    }
    const name = contactName.value.trim();
    contactName.setCustomValidity(name ? '' : copy.requiredName);
    const text = message.value.trim();
    message.setCustomValidity(text.length < 20 || text.length > 10000 ? copy.invalid : '');
    if (!form.reportValidity()) return false;
    contactName.value = name;
    message.value = text;
    sending = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = copy.sending;
    return true;
  };
  // Restore controls after Back, including the browser's back/forward cache.
  window.addEventListener('pageshow', () => {
    sending = false;
    submit.disabled = false;
    form.removeAttribute('aria-busy');
    status.textContent = '';
  });
})();
