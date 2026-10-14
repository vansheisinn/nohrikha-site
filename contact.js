/* Native POST deliberately leaves CAPTCHA and delivery confirmation to the
 * approved processor. This page never claims that a message was delivered. */
(() => {
  'use strict';
  const form = document.querySelector('#feedback-form');
  if (!form) return;
  const lang = document.documentElement.lang;
  const copy = {
    ru: {
      ready: 'Отправка через Formspree. После нажатия вы перейдёте на страницу сервиса для проверки CAPTCHA и результата отправки.',
      privacy: 'Сообщение и указанные контакты передаются Formspree для обработки обращения. Имя и email необязательны. Сервис может получать IP-адрес и сведения о браузере; техническая анонимность не гарантируется. Автоматической публикации нет. Не отправляйте чувствительные данные. Политика конфиденциальности Formspree',
      invalid: 'Введите от 20 до 10 000 символов, не считая пробелов по краям.',
      blocked: 'Отправка заблокирована проверкой формы. Проверьте заполнение полей.',
      sending: 'Переход к сервису отправки. Дождитесь подтверждения на его странице; сообщение ещё не подтверждено.'
    },
    en: {
      ready: 'Sending via Formspree. You will go to the service’s page for CAPTCHA verification and the submission result.',
      privacy: 'Your message and any contact details are sent to Formspree to process your enquiry. Name and email are optional. The service may receive your IP address and browser information; technical anonymity is not guaranteed. Nothing is published automatically. Do not submit sensitive data. Formspree privacy policy',
      invalid: 'Enter 20 to 10,000 characters, excluding leading and trailing whitespace.',
      blocked: 'Submission was blocked by a form check. Check the fields.',
      sending: 'Opening the sending service. Wait for confirmation on its page; delivery has not been confirmed yet.'
    },
    de: {
      ready: 'Versand über Formspree. Sie gelangen zur Seite des Dienstes für die CAPTCHA-Prüfung und das Ergebnis.',
      privacy: 'Nachricht und freiwillige Kontaktdaten werden zur Bearbeitung an Formspree übermittelt. Name und E-Mail sind optional. Der Dienst kann IP-Adresse und Browserdaten erhalten; technische Anonymität ist nicht garantiert. Keine automatische Veröffentlichung. Keine sensiblen Daten senden. Datenschutzerklärung von Formspree',
      invalid: 'Geben Sie 20 bis 10.000 Zeichen ohne Leerzeichen am Anfang und Ende ein.',
      blocked: 'Eine Formularprüfung hat den Versand blockiert. Prüfen Sie die Felder.',
      sending: 'Der Versanddienst wird geöffnet. Warten Sie dort auf eine Bestätigung; der Empfang ist noch nicht bestätigt.'
    },
    kk: {
      ready: 'Formspree арқылы жіберіледі. CAPTCHA тексеруі және жіберу нәтижесі үшін сервис бетіне өтесіз.',
      privacy: 'Хабарламаңыз бен көрсетілген байланыс деректері өтінішті өңдеу үшін Formspree сервисіне беріледі. Аты-жөніңіз бен email міндетті емес. Сервис IP мекенжайы мен браузер деректерін алуы мүмкін; техникалық анонимділікке кепілдік жоқ. Автоматты жариялау жоқ. Құпия деректерді жібермеңіз. Formspree құпиялылық саясаты',
      invalid: 'Басы мен соңындағы бос орындарды есептемегенде, 20–10 000 таңба енгізіңіз.',
      blocked: 'Нысанды тексеру жіберуді бұғаттады. Өрістерді тексеріңіз.',
      sending: 'Жіберу сервисі ашылуда. Оның бетіндегі растауды күтіңіз; қабылданғаны әлі расталмаған.'
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
  document.querySelector('#feedback-availability').textContent = copy.ready;
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
