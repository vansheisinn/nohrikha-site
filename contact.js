/* Native POST deliberately leaves CAPTCHA and delivery confirmation to the
 * approved processor. This page never claims that a message was delivered. */
(() => {
  'use strict';
  const form = document.querySelector('#feedback-form');
  if (!form) return;
  const lang = document.documentElement.lang;
  const copy = {
    ru: {
      privacy: 'Сообщение и указанные контакты передаются Formspree для рассмотрения обращения и ответа. Сообщения не публикуются автоматически. Политика конфиденциальности',
      invalid: 'Введите от 20 до 10 000 символов, не считая пробелов по краям.',
      blocked: 'Отправка заблокирована проверкой формы. Проверьте заполнение полей.',
      sending: 'Открываем страницу отправки…'
    },
    en: {
      privacy: 'Your message and any contact details are sent to Formspree to review and reply to your enquiry. Messages are not published automatically. Privacy policy',
      invalid: 'Enter 20 to 10,000 characters, excluding leading and trailing whitespace.',
      blocked: 'Submission was blocked by a form check. Check the fields.',
      sending: 'Opening the submission page…'
    },
    de: {
      privacy: 'Nachricht und angegebene Kontaktdaten werden über Formspree zur Bearbeitung und Beantwortung übermittelt. Keine automatische Veröffentlichung. Datenschutzerklärung',
      invalid: 'Geben Sie 20 bis 10.000 Zeichen ohne Leerzeichen am Anfang und Ende ein.',
      blocked: 'Eine Formularprüfung hat den Versand blockiert. Prüfen Sie die Felder.',
      sending: 'Die Versandseite wird geöffnet…'
    },
    kk: {
      privacy: 'Хабарлама мен көрсетілген байланыс деректері өтінішті қарау және жауап беру үшін Formspree сервисіне беріледі. Хабарламалар автоматты түрде жарияланбайды. Құпиялылық саясаты',
      invalid: 'Басы мен соңындағы бос орындарды есептемегенде, 20–10 000 таңба енгізіңіз.',
      blocked: 'Нысанды тексеру жіберуді бұғаттады. Өрістерді тексеріңіз.',
      sending: 'Жіберу беті ашылуда…'
    }
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
  // Returning true invokes the browser's native HTTPS POST, including server CAPTCHA.
  form.onsubmit = () => {
    if (sending) return false;
    if (trap.value.trim()) {
      status.textContent = copy.blocked;
      return false;
    }
    const text = message.value.trim();
    message.setCustomValidity(text.length < 20 || text.length > 10000 ? copy.invalid : '');
    if (!form.reportValidity()) return false;
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
