'use strict';
(() => {
  const form = document.querySelector('#draft-form');
  if (!form) return;
  const anonymous = document.querySelector('#anonymous');
  const name = document.querySelector('#name');
  const email = document.querySelector('#email');
  const message = document.querySelector('#message');
  const download = document.querySelector('#download');
  const status = document.querySelector('#draft-status');
  const lang = document.documentElement.lang;
  const copy = {
    ru: ['Введите сообщение.', 'Нохриха — черновик. НЕ ОТПРАВЛЕН.', 'Без имени и контактов', 'Имя', 'Скачивание черновика запрошено. Сообщение не отправлено.'],
    en: ['Please enter a message.', 'Nohrikha — draft. NOT SENT.', 'No name or contact details', 'Name', 'Draft download requested. The message has not been sent.'],
    de: ['Bitte geben Sie eine Nachricht ein.', 'Nohrikha — Entwurf. NICHT GESENDET.', 'Ohne Namen und Kontaktdaten', 'Name', 'Download des Entwurfs angefordert. Die Nachricht wurde nicht gesendet.'],
    kk: ['Хабарламаны енгізіңіз.', 'Нохриха — нобай. ЖІБЕРІЛГЕН ЖОҚ.', 'Аты мен байланыс деректері көрсетілмеген', 'Аты', 'Нобайды жүктеп алу сұралды. Хабарлама жіберілген жоқ.']
  }[lang];
  form.addEventListener('submit', event => event.preventDefault());
  anonymous.addEventListener('change', () => {
    name.disabled = anonymous.checked;
    email.disabled = anonymous.checked;
    status.textContent = '';
  });
  form.addEventListener('input', () => { status.textContent = ''; });
  download.disabled = false;
  download.addEventListener('click', () => {
    message.setCustomValidity(message.value.trim() ? '' : copy[0]);
    if (!form.reportValidity()) return;
    const lines = [copy[1]];
    if (anonymous.checked) {
      lines.push(copy[2]);
    } else {
      if (name.value.trim()) lines.push(`${copy[3]}: ${name.value.trim()}`);
      if (email.value.trim()) lines.push(`Email: ${email.value.trim()}`);
    }
    lines.push('', message.value.trim());
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nohrikha-draft-${lang === 'kk' ? 'kz' : lang}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = copy[4];
  });
  message.addEventListener('input', () => message.setCustomValidity(''));
})();
