'use strict';
/* global window, document */
const form = document.getElementById('form');
const input = document.getElementById('ref');
const go = document.getElementById('go');
const status = document.getElementById('status');

function show(text, kind) {
  status.textContent = text;
  status.className = kind || '';
}

window.petPrompt.initial().then((text) => {
  if (text) input.value = text;
  input.focus();
  input.select();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) { show('주소나 이름을 넣어 주세요', 'err'); return; }
  go.disabled = true;
  input.disabled = true;
  show('펫 데려오는 중…');
  const r = await window.petPrompt.submit(text);
  if (r && r.ok) {
    show(`${r.displayName} 왔어요!`, 'ok');
    setTimeout(() => window.petPrompt.close(), 1200);
  } else {
    show((r && r.error) || '받지 못했어요', 'err');
    go.disabled = false;
    input.disabled = false;
    input.focus();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.petPrompt.close();
});
