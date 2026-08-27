// StoryListener.js — listens to the parent's voice (the remote WebRTC stream from the
// Vonage call) and turns it into words in real time using Deepgram's streaming API.
//
// Why browser-side: the child's XR app already holds the parent's audio stream (it drives
// the lip-sync avatar), so we fork it here — no extra media leg, no server audio proxy.
// If no Deepgram key is configured the app still works; words just won't light up.
//
//   const l = new StoryListener({ onWords: (words, isFinal) => ..., onError });
//   await l.start(remoteMediaStream);
//   l.stop();
export class StoryListener {
  constructor({ onWords, onStatus } = {}) {
    this.onWords = onWords || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.recorder = null;
    this.keepAlive = null;
  }

  async start(stream) {
    let key = null;
    try {
      const r = await fetch('/api/asr-key');
      if (r.ok) key = (await r.json()).key;
    } catch (e) {
      /* no key */
    }
    if (!key) {
      this.onStatus('asr-off');
      console.warn('StoryListener: no ASR key configured — word highlighting disabled');
      return false;
    }

    const params = new URLSearchParams({
      model: 'nova-2',
      language: 'en-US',
      punctuate: 'true',
      interim_results: 'true',
      smart_format: 'false',
      endpointing: '300',
    });
    // Deepgram accepts the key via the WebSocket sub-protocol (browsers can't set headers)
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', key]);

    this.ws.onopen = () => {
      this.onStatus('listening');
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      this.recorder = new MediaRecorder(stream, { mimeType: mime });
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data);
      };
      this.recorder.start(250); // 250 ms chunks
      this.keepAlive = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }, 8000);
    };

    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        const alt = data.channel?.alternatives?.[0];
        if (!alt || !alt.transcript) return;
        const words = alt.words?.map((w) => w.word) || alt.transcript.split(/\s+/);
        this.onWords(words, !!data.is_final, alt.transcript);
      } catch (e) {
        /* ignore non-JSON */
      }
    };

    this.ws.onerror = (e) => {
      console.error('StoryListener websocket error', e);
      this.onStatus('asr-error');
    };
    this.ws.onclose = () => this.onStatus('asr-closed');
    return true;
  }

  stop() {
    clearInterval(this.keepAlive);
    try {
      this.recorder?.state !== 'inactive' && this.recorder?.stop();
    } catch (e) {}
    try {
      this.ws?.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws?.close();
    } catch (e) {}
    this.recorder = null;
    this.ws = null;
  }
}

// Matches spoken words against the current page and returns how many page words have been
// read so far. Tolerant to skipped/mis-recognised words: looks ahead a few words.
export class ReadingTracker {
  constructor(pageWords) {
    this.reset(pageWords);
  }
  reset(pageWords) {
    this.words = pageWords.map(norm);
    this.pos = 0;
  }
  feed(spokenWords) {
    for (const raw of spokenWords) {
      const w = norm(raw);
      if (!w) continue;
      for (let j = this.pos; j < Math.min(this.pos + 5, this.words.length); j++) {
        if (this.words[j] === w) {
          this.pos = j + 1;
          break;
        }
      }
    }
    return this.pos;
  }
}

function norm(w) {
  return String(w).toLowerCase().replace(/[^a-z0-9']/g, '');
}
