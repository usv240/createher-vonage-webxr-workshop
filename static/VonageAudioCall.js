// VonageAudioCall.js — the child's side of Once Upon a Call.
//
// A parent dials a plain phone number. Vonage rings this WebXR app (Client SDK in-app leg).
// When the child answers, the parent appears as a lip-synced avatar beside an AR storybook.
// The parent's keypad turns pages (async DTMF -> server -> socket.io -> here), their voice
// lights up the words (StoryListener), and the child can send love back down the phone line
// (server plays text-to-speech into the parent's leg only).
import * as THREE from 'three';
import * as xb from 'xrblocks';
import { LipsyncMouth } from 'lipsync';
import { Storybook } from './Storybook.js';
import { StoryListener, ReadingTracker, wordIndexAtChar } from './StoryListener.js';

// ⌄⌄⌄ Things the child can send to the parent's ear ⌄⌄⌄
const SEND_TO_PARENT = [
  { label: '⭐ Hug', text: '{child} just sent you a big hug.' },
  { label: 'Again!', text: '{child} says: read that page again, please!' },
  { label: 'One more', text: '{child} says: one more page, please!' },
  { label: 'Night', text: '{child} says: goodnight, I love you.' },
];

// How far in front of the child the storybook sits, in metres. Closer = larger on screen.
// Override for filming or a big monitor with ?dist=0.9
const DIST = Math.max(0.6, parseFloat(new URLSearchParams(location.search).get('dist') || '1.05'));

export class VonageAudioCall extends xb.Script {
  constructor() {
    super();
    this.token = '';
    this.client = new vonageClientSDK.VonageClient();
    this.callId = null;
    this.userName = 'XR_User_1';

    // UI
    this.panel = null;
    this.grid = null;
    this.statusText = null;
    this.controlRow = null;
    this.replyPanel = null;

    // avatar
    this.puppetHead = null;
    this.face = null;
    this.mouth = null;
    this._camWorld = new THREE.Vector3();
    this._headWorld = new THREE.Vector3();

    // story
    this.story = null;
    this.book = null;
    this.listener = null;
    this.tracker = null;
    this.socket = null;
    this.state = { page: 0, totalPages: 0, inCall: false, recordings: 0 };
    this.timeline = [];
    this.firedKeywords = new Set();
    this.replay = null; // { audio, timers[] }
    this.preview = null; // { timers[], cancelled } — self-guided tour, no phone needed
    this._last = performance.now();
    this.audioCtx = null;
  }

  // ===================== lifecycle =====================
  async init() {
    console.log('Once Upon a Call — init');
    this._addLights();
    try {
      this.story = await (await fetch('/api/story')).json();
    } catch (e) {
      console.error('Could not load story', e);
    }
    // Panel first: a call can be invited the instant the session exists, and
    // updateControlRow() silently does nothing without a grid to draw into.
    this._createLobbyPanel();
    this.setupVonageListeners();
    this._connectStorySocket();
    // The landing overlay offers the same tour to anyone who never puts on a headset.
    window.addEventListener('ouac:preview', () => this._startPreview());
    window.addEventListener('ouac:replay', () => this._startReplay());
    await this.connectToVonage(this.userName);
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    if (this.book) this.book.update(dt);

    const head = this.puppetHead;
    const cam = xb.core?.camera;
    if (!head || !cam) return;
    cam.getWorldPosition(this._camWorld);
    head.getWorldPosition(this._headWorld);
    const targetX = 2 * this._headWorld.x - this._camWorld.x;
    const targetZ = 2 * this._headWorld.z - this._camWorld.z;
    head.lookAt(targetX, this._headWorld.y, targetZ);
  }

  _addLights() {
    // Removing the ball-pit demo also removed the only lights in the scene. Add warm bedtime
    // light to the scene root when we can reach it, and to this script otherwise. Materials
    // that must never go black (the parent's face, the book cover) are emissive as well.
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x3a2f4a, 1.6);
    const key = new THREE.DirectionalLight(0xffe9c4, 1.6);
    key.position.set(0.6, 1.8, 1.2);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.6);
    fill.position.set(-1.2, 1.0, 0.8);
    const target = xb.core?.scene || this;
    target.add(hemi);
    target.add(key);
    target.add(fill);
  }

  // ===================== panels =====================
  _createLobbyPanel() {
    if (this.panel) return;
    this.panel = new xb.SpatialPanel({ backgroundColor: '#1a1a2ee6', width: 1.1, height: 0.36 });
    this.panel.position.set(0, xb.user.height + 0.62, -DIST - 0.08);
    this.add(this.panel);
    this.grid = this.panel.addGrid();
    this.grid.addRow({ weight: 0.35 }).addText({
      text: 'Once Upon a Call',
      fontColor: '#ffd54a',
      fontSize: 0.09,
    });
    this.statusText = this.grid.addRow({ weight: 0.35 }).addText({
      text: 'Waiting for a story call…',
      fontColor: '#ffffff',
      fontSize: 0.06,
    });
    this.updateControlRow('IDLE');
  }

  updateControlRow(state) {
    if (!this.grid) return;
    if (this.controlRow) {
      this.grid.remove(this.controlRow);
      this.controlRow = null;
      this.grid.resetLayout();
    }
    this.controlRow = this.grid.addRow({ weight: 0.3 });

    if (state === 'IDLE') {
      // Anyone can watch the whole experience without a phone — a judge opening the link,
      // a caregiver deciding whether this is for their family.
      const previewBtn = this.controlRow.addCol({ weight: 0.5 }).addTextButton({
        text: '▶ Preview',
        fontSize: 0.22,
        backgroundColor: '#2f5d3a',
        fontColor: '#ffffff',
      });
      previewBtn.onTriggered = () => this._startPreview();

      const hasStory = this.state.recordings > 0;
      const replayBtn = this.controlRow.addCol({ weight: 0.5 }).addTextButton({
        text: hasStory ? 'Replay' : 'No story yet',
        fontSize: 0.22,
        backgroundColor: hasStory ? '#3b3b80' : '#2b2b3a',
        fontColor: hasStory ? '#ffffff' : '#8a8aa0',
      });
      replayBtn.onTriggered = () => this._startReplay();
    } else if (state === 'PREVIEW') {
      const stopBtn = this.controlRow.addCol({ weight: 1 }).addTextButton({
        text: 'Stop preview',
        fontSize: 0.3,
        backgroundColor: '#80331a',
        fontColor: '#ffffff',
      });
      stopBtn.onTriggered = () => this._stopPreview();
    } else if (state === 'INCOMING') {
      const answerBtn = this.controlRow.addCol({ weight: 0.5 }).addIconButton({
        text: 'call',
        fontSize: 0.5,
        backgroundColor: '#00c853',
      });
      answerBtn.onTriggered = () => this._onAnswer();
      const rejectBtn = this.controlRow.addCol({ weight: 0.5 }).addIconButton({
        text: 'call_end',
        fontSize: 0.5,
        backgroundColor: '#d50000',
      });
      rejectBtn.onTriggered = () => this._onReject();
    } else if (state === 'CONNECTED') {
      const hangupBtn = this.controlRow.addCol({ weight: 1 }).addIconButton({
        text: 'call_end',
        fontSize: 0.5,
        backgroundColor: '#d50000',
      });
      hangupBtn.onTriggered = () => this._onHangup();
    } else if (state === 'REPLAY') {
      const stopBtn = this.controlRow.addCol({ weight: 1 }).addTextButton({
        text: 'Stop replay',
        fontSize: 0.3,
        backgroundColor: '#80331a',
        fontColor: '#ffffff',
      });
      stopBtn.onTriggered = () => this._stopReplay();
    }
    this.panel.updateLayouts();
  }

  _setStatus(text) {
    if (this.statusText) this.statusText.text = text;
  }

  _createReplyPanel() {
    if (this.replyPanel) return;
    this.replyPanel = new xb.SpatialPanel({ backgroundColor: '#1a1a2ee6', width: 0.5, height: 0.62 });
    this.replyPanel.position.set(1.02, xb.user.height - 0.02, -DIST);
    this.add(this.replyPanel);
    const grid = this.replyPanel.addGrid();
    grid.addRow({ weight: 0.14 }).addText({
      text: 'Send to ' + (this.story?.parentName || 'parent'),
      fontColor: '#ffd54a',
      fontSize: 0.05,
    });
    for (const item of SEND_TO_PARENT) {
      const btn = grid.addRow({ weight: 0.2 }).addTextButton({
        text: item.label,
        fontSize: 0.32,
        backgroundColor: '#2e2e50',
        fontColor: '#ffffff',
      });
      btn.onTriggered = () => this._sendToParent(item.text);
    }
    grid.addRow({ weight: 0.1 }).addText({
      text: 'Phone keys:  # next  ·  * back  ·  1 2 3 surprises',
      fontColor: '#cdbfa3',
      fontSize: 0.032,
    });
    this.replyPanel.updateLayouts();
  }

  _removeReplyPanel() {
    if (this.replyPanel) {
      this.remove(this.replyPanel);
      this.replyPanel = null;
    }
  }

  // ===================== avatar =====================
  _createAvatar(stream) {
    if (this.puppetHead) return;
    const head = new THREE.Group();
    // Parent sits to the left of the book, a little lower — "beside the bed"
    head.position.set(-1.0, xb.user.height + 0.02, -DIST);
    const faceMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0xf2d4b3, emissive: 0x6b4f38, emissiveIntensity: 0.85, roughness: 0.6, metalness: 0.0 })
    );
    head.add(faceMesh);
    this.face = new xb.StylizedFace({ showEyes: true });
    head.add(this.face);
    this.mouth = new LipsyncMouth(stream, { target: this.face });
    head.add(this.mouth);
    // a soft halo so the avatar reads as "present"
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.13, 0.16, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    halo.position.z = -0.02;
    head.add(halo);
    this.puppetHead = head;
    this.add(head);
  }

  _removeAvatar() {
    if (!this.puppetHead) return;
    if (this.mouth) {
      this.mouth.parent?.remove(this.mouth);
      this.mouth = null;
    }
    if (this.face) {
      this.face.parent?.remove(this.face);
      this.face.dispose();
      this.face = null;
    }
    this.remove(this.puppetHead);
    this.puppetHead = null;
  }

  // ===================== storybook =====================
  _createBook() {
    if (this.book || !this.story) return;
    this.book = new Storybook(this.story);
    this.book.position.set(0, xb.user.height - 0.12, -DIST);
    this.book.rotation.x = -0.15;
    this.add(this.book);
    this.tracker = new ReadingTracker(this.book.words);
    this.firedKeywords.clear();
  }

  _removeBook() {
    if (!this.book) return;
    this.remove(this.book);
    this.book = null;
  }

  _applyPage(page) {
    if (!this.book) return;
    this.book.setPage(page);
    this.tracker = new ReadingTracker(this.book.words);
    this.firedKeywords.clear();
  }

  _onSpokenWords(words, isFinal, transcript) {
    if (!this.book || !this.tracker) return;
    const n = this.tracker.feed(words);
    this.book.highlightUpTo(n);
    this.book.setCaption(transcript); // live, not just on isFinal — captions are the point for a deaf child
    this.timeline.push({ t: Date.now(), type: 'words', data: { n } });
    // keywords -> illustration comes alive
    const kw = this.book.page.keywords || {};
    const lower = transcript.toLowerCase();
    for (const [word, effect] of Object.entries(kw)) {
      if (!this.firedKeywords.has(word) && lower.includes(word)) {
        this.firedKeywords.add(word);
        this.book.trigger(effect, 3);
        this.timeline.push({ t: Date.now(), type: 'effect', data: { effect } });
      }
    }
  }

  _playEffectKey(key) {
    const fx = this.story?.effects?.[key];
    if (!fx || !this.book) return;
    const map = { roar: 'roar', twinkle: 'stars-twinkle', hum: 'moon-smile' };
    this.book.trigger(map[fx.sound] || 'dragon-wiggle', 2.5);
    this._beep(fx.sound);
    this.book.setBanner(`${this.story.parentName || 'Parent'} pressed ${key}: ${fx.label}`);
  }

  // Phone audio is quiet in a browser tab, so we add a gain stage (?gain=3 to push it further).
  // Critical: the raw <audio> element is only silenced while the boosted path is actually
  // running. Browsers suspend an AudioContext until a user gesture, and muting the element
  // before that would leave the child hearing nothing at all.
  _boostAudio(audioElement, stream) {
    if (!audioElement) return;
    audioElement.muted = false;
    audioElement.volume = 1;
    const gainValue = parseFloat(new URLSearchParams(location.search).get('gain') || '2.5');
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !(gainValue > 1)) return;
    try {
      const ctx = (this.audioCtx = this.audioCtx || new AC());
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = gainValue;
      src.connect(gain).connect(ctx.destination);

      const sync = () => {
        const running = ctx.state === 'running';
        audioElement.muted = running; // only mute once the boosted path is audible
        console.log(`Call audio: context ${ctx.state}, boost x${gainValue}, element ${running ? 'muted' : 'playing'}`);
      };
      ctx.addEventListener?.('statechange', sync);
      ctx.resume().then(sync).catch(sync);
      sync();

      // Any click/keypress lets the browser start the context, so re-check then too.
      const resume = () => ctx.resume().then(sync).catch(() => {});
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);
      this._boost = { src, gain, ctx, resume, audioElement, sync };
    } catch (e) {
      console.warn('Audio boost unavailable, playing unboosted', e);
      audioElement.muted = false;
    }
  }

  _stopBoost() {
    const b = this._boost;
    if (!b) return;
    try {
      b.src.disconnect();
      b.gain.disconnect();
      b.audioElement.muted = false;
      window.removeEventListener('pointerdown', b.resume);
      window.removeEventListener('keydown', b.resume);
      b.ctx.removeEventListener?.('statechange', b.sync);
    } catch (e) {}
    this._boost = null;
  }

  // tiny synthesized sounds (no assets needed)
  _beep(kind) {
    try {
      this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime;
      if (kind === 'roar') {
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(55, t + 0.6);
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      } else if (kind === 'twinkle') {
        o.type = 'sine';
        o.frequency.setValueAtTime(1200, t);
        o.frequency.setValueAtTime(1800, t + 0.08);
        o.frequency.setValueAtTime(2400, t + 0.16);
        g.gain.setValueAtTime(0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      } else {
        o.type = 'triangle';
        o.frequency.setValueAtTime(220, t);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      }
      o.start(t);
      o.stop(t + 1.3);
    } catch (e) {
      /* audio not available */
    }
  }

  // ===================== child -> parent =====================
  async _sendToParent(template) {
    const text = template.replace('{child}', this.story?.childName || 'Your child');
    this._setStatus('Sending…');
    if (this.book) {
      this.book.trigger('stars-twinkle', 2);
      this.book.setBanner(`You sent: "${text}"`);
    }
    this._beep('twinkle');
    try {
      // Server speaks this into the PARENT's leg only (PUT /v1/calls/{uuid}/talk)
      const r = await fetch('/api/say', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error('server say failed ' + r.status);
      this._setStatus(`Sent to ${this.story?.parentName || 'parent'} 💛`);
    } catch (e) {
      // Fallback: Client SDK TTS into the call
      if (this.callId) await this.client.say(this.callId, text).catch(() => {});
      this._setStatus('Sent 💛');
    }
    this.timeline.push({ t: Date.now(), type: 'sent', data: { text } });
  }

  // ===================== call control =====================
  _onAnswer() {
    this.client
      .answer(this.callId)
      .then(() => {
        this._setStatus('Story time!');
        this.updateControlRow('CONNECTED');
        this.timeline = [];
        this._createBook();
        this._applyPage(this.state.page || 0);
        this.book?.setBanner(`${this.story?.parentName || 'Parent'} is on the line…`);
        this._createReplyPanel();

        const audioElement = this.client.getAudioOutputElement();
        const remoteStream = audioElement?.srcObject;
        if (remoteStream) {
          this._boostAudio(audioElement, remoteStream);
          this._createAvatar(remoteStream);
          this.listener = new StoryListener({
            onWords: (w, f, tr) => this._onSpokenWords(w, f, tr),
            onStatus: (s) => {
              if (s === 'listening') this.book?.setBanner('Listening — words light up as they are read');
              if (s === 'asr-off') this.book?.setBanner('Reading along (add a Deepgram key to light up words)');
            },
          });
          this.listener.start(remoteStream);
        }
      })
      .catch((error) => console.error('Error answering call: ', error));
  }

  _onReject() {
    this.client.reject(this.callId).catch(() => {});
    this._endCallUI();
  }

  _onHangup() {
    this.client.hangup(this.callId).catch(() => {});
    this._endCallUI();
  }

  async _endCallUI() {
    this._stopBoost();
    this.listener?.stop();
    this.listener = null;
    this._removeAvatar();
    this._removeReplyPanel();
    if (this.timeline.length) {
      const events = this.timeline;
      this.timeline = [];
      fetch('/api/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      }).catch(() => {});
    }
    if (this.book) this.book.setBanner('The end. Saving tonight\'s story…');
    this.callId = null;
    this._setStatus('Waiting for a story call…');
    this.updateControlRow('IDLE');
  }

  setupVonageListeners() {
    this.client.on('callInvite', (callId, from) => {
      this.callId = callId;
      this._stopPreview();   // a real parent always outranks the demo tour
      this._stopReplay();
      const masked = String(from).replace(/\d(?=(?:\D*\d){4})/g, '*');
      this._setStatus(`${this.story?.parentName || 'Someone'} is calling (${masked})`);
      this.updateControlRow('INCOMING');
      // gentle ring: chime + let the landing page know
      this._beep('twinkle');
      window.dispatchEvent(new Event('ouac:ring'));
      // Little ones can't hit a button: auto-answer if the caregiver enabled it
      if (window.OUAC?.autoAnswer?.()) setTimeout(() => this.callId === callId && this._onAnswer(), 1200);
    });
    this.client.on('legStatusUpdate', (callId, legId, status) => console.log('leg status:', status));
    this.client.on('callInviteCancel', () => {
      this.callId = null;
      this._setStatus('Missed call');
      this.updateControlRow('IDLE');
    });
    this.client.on('callHangup', (callId, quality, reason) => {
      console.log(`Call hung up: ${reason}`);
      this._endCallUI();
    });
  }

  async connectToVonage(name) {
    try {
      const response = await fetch(`/token?name=${name}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.token = (await response.json()).token;
      const sessionId = await this.client.createSession(this.token);
      console.log('Session created successfully. Session ID:', sessionId);
      this._setStatus('Waiting for a story call…');
    } catch (error) {
      console.error('Connection failed:', error);
      this._setStatus('Connection failed.');
    }
  }

  // ===================== server events =====================
  _connectStorySocket() {
    if (typeof io === 'undefined') return console.warn('socket.io client not loaded');
    this.socket = io();
    this.socket.on('state', (s) => {
      const pageChanged = s.page !== this.state.page;
      this.state = s;
      if (pageChanged && this.book && !this.preview) {
        this._applyPage(s.page);
        this._beep('twinkle');
      }
      if (!s.inCall && !this.callId && this.panel) {
        this.updateControlRow(this.replay ? 'REPLAY' : this.preview ? 'PREVIEW' : 'IDLE');
      }
    });
    this.socket.on('keypad', ({ digit }) => {
      if (this.book && (digit === '#' || digit === '*')) {
        this.book.setBanner(`${this.story?.parentName || 'Parent'} turned the page (${digit})`);
      }
    });
    this.socket.on('effect', ({ key }) => this._playEffectKey(key));
    this.socket.on('recording', ({ count }) => {
      this.state.recordings = count;
      if (this.book) this.book.setBanner('Tonight\'s story is saved 📖');
      if (!this.callId) this.updateControlRow('IDLE');
    });
    this.socket.on('call:ended', () => {
      if (this.callId) this._endCallUI();
    });
  }

  // ===================== preview (the tour, no phone needed) =====================
  // The whole point of this project is that the parent needs nothing but a phone — but the
  // person *opening this link* usually has no second phone to hand. Preview narrates the book
  // with the browser's own speech synthesis and drives the identical highlight/effect path a
  // real parent's voice does, so the experience is never a locked door.
  _startPreview() {
    if (this.preview || this.replay || this.callId) return;
    this._createBook();
    if (!this.book || !this.story) return this._setStatus('Story not loaded yet.');
    this.preview = { timers: [], cancelled: false };
    this._setStatus('Preview — no call needed');
    this.updateControlRow('PREVIEW');
    window.dispatchEvent(new Event('ouac:preview-start'));
    this._previewFrom(0);
  }

  _previewFrom(i) {
    const run = this.preview;
    if (!run || run.cancelled) return;
    if (i >= this.story.pages.length) {
      this.book?.setBanner('That is the whole story. Now give the number to someone far away.');
      run.timers.push(setTimeout(() => this._stopPreview(), 6000));
      return;
    }
    this._applyPage(i);
    this.book.setBanner(`Preview — page ${i + 1} of ${this.story.pages.length}`);
    this._narratePage(i, () => {
      if (!this.preview || this.preview.cancelled) return;
      this._beep('twinkle');
      this.preview.timers.push(setTimeout(() => this._previewFrom(i + 1), 900));
    });
  }

  // Speaks one page and highlights along with it. Falls back to timed pacing where speech
  // synthesis is missing or silent, so the tour always completes.
  _narratePage(i, done) {
    const run = this.preview;
    const page = this.story.pages[i];
    const text = page.text;
    const words = text.split(/\s+/).filter(Boolean);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    const showUpTo = (n) => {
      if (!this.preview || this.preview.cancelled || !this.book) return;
      this.book.highlightUpTo(n);
      this.book.setCaption(words.slice(0, n).join(' '));
      const said = words.slice(0, n).join(' ').toLowerCase();
      for (const [word, effect] of Object.entries(page.keywords || {})) {
        if (!this.firedKeywords.has(word) && said.includes(word)) {
          this.firedKeywords.add(word);
          this.book.trigger(effect, 3);
        }
      }
    };

    const synth = window.speechSynthesis;
    if (synth && typeof SpeechSynthesisUtterance !== 'undefined') {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.85;
        u.pitch = 1.05;
        // charIndex -> word index, so the glow tracks the narration exactly
        u.onboundary = (e) => {
          if (e.name && e.name !== 'word') return;
          showUpTo(wordIndexAtChar(text, e.charIndex)); // unit-tested in test/preview.test.js
        };
        u.onend = () => { showUpTo(words.length); finish(); };
        u.onerror = () => { showUpTo(words.length); finish(); };
        synth.cancel();
        synth.speak(u);
        run.utterance = u;
        // Chrome silently drops long utterances and never fires onend; keep the tour moving.
        run.timers.push(setTimeout(() => { showUpTo(words.length); finish(); }, 1200 + words.length * 620));
        return;
      } catch (e) {
        /* fall through to timed pacing */
      }
    }
    words.forEach((_, n) => run.timers.push(setTimeout(() => showUpTo(n + 1), (n + 1) * 380)));
    run.timers.push(setTimeout(finish, words.length * 380 + 700));
  }

  _stopPreview() {
    if (!this.preview) return;
    this.preview.cancelled = true;
    this.preview.timers.forEach(clearTimeout);
    this.preview = null;
    try { window.speechSynthesis?.cancel(); } catch (e) { /* not available */ }
    this.book?.setBanner('');
    this.book?.setCaption('');
    if (!this.callId) {
      this._setStatus('Waiting for a story call…');
      this.updateControlRow('IDLE');
    }
    window.dispatchEvent(new Event('ouac:preview-end'));
  }

  // ===================== replay (keepsake mode) =====================
  async _startReplay() {
    if (this.replay) return;
    this._stopPreview();
    let data;
    try {
      const r = await fetch('/api/replay/latest');
      if (!r.ok) throw new Error('none');
      data = await r.json();
    } catch (e) {
      this._setStatus('No saved story yet.');
      return;
    }
    this._createBook();
    if (!this.book) return;
    this._applyPage(0);
    const who = this.story?.parentName || 'parent';

    // The page turns, highlights and effects are ours; the audio comes from Vonage. If the
    // recording is still uploading (or the download failed) the visual replay still runs, so
    // the keepsake is never a dead button.
    const timers = [];
    const t0 = data.startTime;
    for (const ev of data.events || []) {
      const delay = Math.max(0, ev.t - t0);
      timers.push(
        setTimeout(() => {
          if (ev.type === 'page') this._applyPage(ev.data.page);
          else if (ev.type === 'words') this.book?.highlightUpTo(ev.data.n);
          else if (ev.type === 'effect') this.book?.trigger(ev.data.effect, 3);
          else if (ev.type === 'keypad') this._playEffectKey(ev.data.digit);
        }, delay)
      );
    }
    const lastEvent = (data.events || []).reduce((m, ev) => Math.max(m, ev.t - t0), 0);

    let audio = null;
    if (data.audioUrl) {
      audio = new Audio(data.audioUrl);
      audio.onended = () => this._stopReplay();
      audio.onerror = () => this.book?.setBanner('Replaying the pages — audio unavailable');
      audio.play().catch((e) => console.warn('autoplay blocked; press Replay again', e));
      this.book.setBanner(`Replaying ${who}'s story from last time`);
    } else {
      this.book.setBanner(`Replaying ${who}'s pages — the recording is still uploading`);
      timers.push(setTimeout(() => this._stopReplay(), lastEvent + 3000));
    }

    this.replay = { audio, timers };
    this._setStatus('Replaying…');
    this.updateControlRow('REPLAY');
  }

  _stopReplay() {
    if (!this.replay) return;
    this.replay.timers.forEach(clearTimeout);
    this.replay.audio?.pause();
    this.replay = null;
    this.book?.setBanner('');
    if (!this.callId) {
      this._setStatus('Waiting for a story call…');
      this.updateControlRow('IDLE');
    }
  }
}
