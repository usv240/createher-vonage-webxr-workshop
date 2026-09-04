// Landing overlay: live status + the number to call. Hides itself when the storybook opens.
(function () {
  const $ = (id) => document.getElementById(id);
  const landing = $('landing');
  const statusEl = $('status');
  const statusText = $('status-text');

  function setStatus(kind, text) {
    statusEl.className = 'status ' + kind;
    statusText.textContent = text;
  }

  fetch('/api/info')
    .then((r) => r.json())
    .then((info) => {
      $('phone').textContent = info.phoneFormatted || info.phone || 'number not set';
      $('phone-mini').textContent = info.phoneFormatted || info.phone || '';
      document.title = `Once Upon a Call — ${info.childName}'s storybook`;
    })
    .catch(() => ($('phone').textContent = 'number not set'));

  // Remember the auto-answer preference for little ones
  const auto = $('autoanswer');
  try {
    auto.checked = localStorage.getItem('ouac-autoanswer') === '1';
  } catch (e) {}
  auto.addEventListener('change', () => {
    try {
      localStorage.setItem('ouac-autoanswer', auto.checked ? '1' : '0');
    } catch (e) {}
  });
  window.OUAC = { autoAnswer: () => auto.checked };

  if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('connect', () => setStatus('waiting', 'Ready — waiting for a story call'));
    socket.on('disconnect', () => setStatus('error', 'Server disconnected'));
    socket.on('state', (s) => {
      if (s.inCall) setStatus('live', `Story time — page ${s.page + 1} of ${s.totalPages}`);
      else setStatus('waiting', s.recordings ? `Ready — ${s.recordings} saved stor${s.recordings === 1 ? 'y' : 'ies'}` : 'Ready — waiting for a story call');
    });
    socket.on('recording', () => setStatus('saved', "Tonight's story is saved"));
  }

  // Slim top bar once the scene is live (simulator starts immediately on laptops)
  const toggle = $('toggle-landing');
  function setCompact(on) {
    landing.classList.toggle('compact', on);
    toggle.textContent = on ? '▾ Guide' : '▴ Close';
  }
  toggle.addEventListener('click', () => setCompact(!landing.classList.contains('compact')));
  setTimeout(() => setCompact(true), 6000);              // give first-time viewers a look, then get out of the way
  window.addEventListener('ouac:ring', () => setCompact(true));

  // XR Blocks injects its own "OPEN THE STORYBOOK" button; hide the landing when it's pressed.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && /storybook|end/i.test(btn.textContent)) landing.classList.add('hidden');
  });
  window.addEventListener('ouac:ring', () => setStatus('ringing', 'Incoming story call…'));
})();
