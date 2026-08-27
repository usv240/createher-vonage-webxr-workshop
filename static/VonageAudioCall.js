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
import { StoryListener, ReadingTracker } from './StoryListener.js';

// ⌄⌄⌄ Things the child can send to the parent's ear ⌄⌄⌄
const SEND_TO_PARENT = [
  { label: '⭐ Hug', text: '{child} just sent you a big hug.' },
  { label: 'Again!', text: '{child} says: read that page again, please!' },
  { label: 'One more', text: '{child} says: one more page, please!' },
  { label: 'Night', text: '{child} says: goodnight, I love you.' },
];

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
    this._last = performance.now();
    this.audioCtx = null;
  }

  // ===================== lifecycle =====================
  async init() {
    console.log('Once Upon a Call — init');
    try {
      this.story = await (await fetch('/api/story')).json();
    } catch (e) {
      console.error('Could not load story', e);
    }
    this.setupVonageListeners();
    this._connectStorySocket();
    await this.connectToVonage(this.userName);
    this._createLobbyPanel();
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

  // ===================== panels =====================
  _createLobbyPanel() {
    if (this.panel) return;
    this.panel = new xb.SpatialPanel({ backgroundColor: '#1a1a2ecc', width: 1.0, height: 0.42 });
    this.panel.position.set(0, xb.user.height + 0.35, -xb.user.objectDistance);
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
      const replayBtn = this.controlRow.addCol({ weight: 1 }).addTextButton({
        text: this.state.recordings > 0 ? 'Replay last story' : 'No saved stories yet',
        fontSize: 0.3,
        backgroundColor: this.state.recordings > 0 ? '#3b3b80' : '#2b2b2b',
        fontColor: '#ffffff',
      });
      replayBtn.onTriggered = () => this._startReplay();
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
    this.replyPanel = new xb.SpatialPanel({ backgroundColor: '#1a1a2ecc', width: 0.55, height: 0.62 });
    this.replyPanel.position.set(0.85, xb.user.height - 0.15, -xb.user.objectDistance);
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
    head.position.set(-0.75, xb.user.height - 0.1, -xb.user.objectDistance + 0.1);
    const faceMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0xf2d4b3, roughness: 0.6, metalness: 0.05 })
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
    this.book.position.set(0.05, xb.user.height - 0.2, -xb.user.objectDistance);
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
      const masked = String(from).replace(/\d(?=(?:\D*\d){4})/g, '*');
      this._setStatus(`${this.story?.parentName || 'Someone'} is calling (${masked})`);
      this.updateControlRow('INCOMING');
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
      if (pageChanged && this.book) {
        this._applyPage(s.page);
        this._beep('twinkle');
      }
      if (!s.inCall && !this.callId && this.panel) this.updateControlRow(this.replay ? 'REPLAY' : 'IDLE');
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

  // ===================== replay (keepsake mode) =====================
  async _startReplay() {
    if (this.replay) return;
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
    this._applyPage(0);
    this.book.setBanner(`Replaying ${this.story?.parentName || 'parent'}'s story from last time`);
    const audio = new Audio(data.audioUrl);
    const timers = [];
    const t0 = data.startTime;
    for (const ev of data.events) {
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
    audio.onended = () => this._stopReplay();
    audio.play().catch((e) => console.warn('autoplay blocked; click again', e));
    this.replay = { audio, timers };
    this._setStatus('Replaying…');
    this.updateControlRow('REPLAY');
  }

  _stopReplay() {
    if (!this.replay) return;
    this.replay.timers.forEach(clearTimeout);
    this.replay.audio.pause();
    this.replay = null;
    this.book?.setBanner('');
    this._setStatus('Waiting for a story call…');
    this.updateControlRow('IDLE');
  }
}
