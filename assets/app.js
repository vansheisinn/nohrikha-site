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
  const ru = document.documentElement.lang === 'ru';
  form.addEventListener('submit', event => event.preventDefault());
  anonymous.addEventListener('change', () => {
    name.disabled = anonymous.checked;
    email.disabled = anonymous.checked;
    status.textContent = '';
  });
  form.addEventListener('input', () => { status.textContent = ''; });
  download.disabled = false;
  download.addEventListener('click', () => {
    message.setCustomValidity(message.value.trim() ? '' : (ru ? 'Введите сообщение.' : 'Please enter a message.'));
    if (!form.reportValidity()) return;
    const lines = [ru ? 'Нохриха — черновик. НЕ ОТПРАВЛЕН.' : 'Nohrikha — draft. NOT SENT.'];
    if (anonymous.checked) {
      lines.push(ru ? 'Без имени и контактов' : 'No name or contact details');
    } else {
      if (name.value.trim()) lines.push(`${ru ? 'Имя' : 'Name'}: ${name.value.trim()}`);
      if (email.value.trim()) lines.push(`Email: ${email.value.trim()}`);
    }
    lines.push('', message.value.trim());
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nohrikha-draft-${ru ? 'ru' : 'en'}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = ru ? 'Скачивание черновика запрошено. Сообщение не отправлено.' : 'Draft download requested. The message has not been sent.';
  });
  message.addEventListener('input', () => message.setCustomValidity(''));
})();
