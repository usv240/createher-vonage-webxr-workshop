// Once Upon a Call — server
// A parent on any plain phone dials in; the child sees them in an AR storybook.
//
// Vonage Voice API features used here:
//   - Client SDK in-app leg (child's XR app answers the call)   -> /token, /voice/answer connect{app}
//   - record action (every story is saved as a keepsake)        -> /voice/answer, /voice/recording
//   - asynchronous DTMF (phone keypad drives the AR book)       -> subscribeDTMF, /voice/dtmf
//   - per-leg text-to-speech (AR world talks back to parent)    -> playTTS on the parent's leg
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server: SocketServer } = require('socket.io');
const { tokenGenerate } = require('@vonage/jwt');
const { Vonage } = require('@vonage/server-sdk');

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: '*' } });
const port = process.env.PORT || 3000;

// ---------- credentials ----------
const appId = process.env.API_APPLICATION_ID;
let privateKey;
if (process.env.PRIVATE_KEY) {
  try {
    privateKey = fs.readFileSync(process.env.PRIVATE_KEY, 'utf8');
  } catch (error) {
    privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
  }
} else if (process.env.PRIVATE_KEY64) {
  privateKey = Buffer.from(process.env.PRIVATE_KEY64, 'base64');
}
if (!appId || !privateKey) {
  console.error('Missing API_APPLICATION_ID and/or PRIVATE_KEY64 in .env');
  process.exit();
}
const vonage = new Vonage({ applicationId: appId, privateKey });
const vonageNumber = process.env.VONAGE_PHONE_NUMBER;

// Public base URL Vonage can reach (Codespaces or PUBLIC_URL for ngrok etc.)
const BASE_URL =
  process.env.PUBLIC_URL ||
  (process.env.CODESPACE_NAME
    ? `https://${process.env.CODESPACE_NAME}-${port}.app.github.dev`
    : `http://localhost:${port}`);
console.log('Public base URL:', BASE_URL);

// ---------- story session state (single family for the demo) ----------
const story = require('./static/story.json');
const session = {
  userLoggedIn: null,      // Client SDK username of the child's XR app
  parentLeg: null,         // uuid of the parent's PSTN leg (for per-leg TTS)
  conversationUuid: null,
  page: 0,
  recordings: [],          // { url, uuid, start, end, size }
};

function broadcastState() {
  io.emit('state', {
    page: session.page,
    totalPages: story.pages.length,
    inCall: !!session.parentLeg,
    recordings: session.recordings.length,
  });
}

// ---------- static + middleware ----------
app.use(express.static(path.join(__dirname, 'pages')));
app.use(express.static('static'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, 'pages/index.html')));

// ---------- Client SDK token ----------
async function createUser(displayName) {
  const username = displayName.toLowerCase().replaceAll(' ', '-');
  try {
    await vonage.users.createUser({ name: username, displayName });
  } catch (e) {
    /* user already exists */
  }
  return username;
}

app.get('/token', async (req, res) => {
  const displayName = req.query.name;
  if (!displayName) return res.status(400).json({ error: 'name required' });
  const username = await createUser(displayName);
  session.userLoggedIn = username;
  console.log(`Token issued for ${username}`);
  const token = tokenGenerate(appId, privateKey, {
    exp: Math.round(Date.now() / 1000) + 86400,
    sub: username,
    acl: {
      paths: {
        '/*/rtc/**': {},
        '/*/sessions/**': {},
        '/*/conversations/**': {},
        '/*/knocking/**': {},
        '/*/legs/**': {},
      },
    },
  });
  res.json({ token });
});

// ---------- NCCO: what happens when the parent dials in ----------
app.get('/voice/answer', (req, res) => {
  console.log('NCCO request:', req.query);

  // Phone -> app (the story call)
  if (req.query.from && !req.query.from_user) {
    if (!session.userLoggedIn) {
      return res.json([
        { action: 'talk', text: "The storybook isn't open yet. Please try again in a moment.", language: 'en-US' },
      ]);
    }
    return res.json([
      {
        action: 'talk',
        language: 'en-US',
        text: `Welcome to Once Upon a Call. Opening ${story.childName}'s storybook. Press pound to turn the page, star to go back.`,
      },
      {
        // Records the whole story from here until hangup. Vonage posts the URL to /voice/recording.
        action: 'record',
        eventUrl: [`${BASE_URL}/voice/recording`],
        format: 'mp3',
      },
      {
        action: 'connect',
        from: req.query.from,
        endpoint: [{ type: 'app', user: session.userLoggedIn }],
      },
    ]);
  }

  // App -> phone / app -> app (kept from the workshop kit)
  const isPhone = /^\d+$/.test(req.query.to || '');
  const endpoint = isPhone
    ? { type: 'phone', number: req.query.to }
    : { type: 'app', user: req.query.to };
  return res.json([
    { action: 'talk', text: 'Please wait while we connect you.' },
    { action: 'connect', from: isPhone ? vonageNumber : req.query.from_user, endpoint: [endpoint] },
  ]);
});

// ---------- call lifecycle events ----------
app.all('/voice/event', async (req, res) => {
  const ev = req.body || {};
  console.log(`EVENT ${ev.status || ev.type || ''} ${ev.direction || ''} leg=${ev.uuid || ''}`);
  res.sendStatus(200);

  // The parent's PSTN leg answered -> remember it and start listening to their keypad
  if (ev.status === 'answered' && ev.direction === 'inbound' && ev.uuid) {
    session.parentLeg = ev.uuid;
    session.conversationUuid = ev.conversation_uuid;
    session.page = 0;
    try {
      await vonage.voice.subscribeDTMF(ev.uuid, `${BASE_URL}/voice/dtmf`);
      console.log('Subscribed to keypad (async DTMF) on parent leg', ev.uuid);
    } catch (e) {
      console.error('subscribeDTMF failed:', e?.response?.data || e.message);
    }
    broadcastState();
  }

  if (ev.status === 'completed' && ev.uuid === session.parentLeg) {
    console.log('Parent hung up');
    session.parentLeg = null;
    io.emit('call:ended');
    broadcastState();
  }
});

// ---------- keypad -> storybook ----------
app.post('/voice/dtmf', (req, res) => {
  res.sendStatus(200);
  const b = req.body || {};
  // Be tolerant of payload shapes: {dtmf:{digits:'#'}} or {digits:'#'} or {digit:'#'}
  const digit = String(b.dtmf?.digits ?? b.digits ?? b.digit ?? '').trim();
  if (!digit) return console.log('DTMF webhook with no digit:', JSON.stringify(b));
  console.log('KEYPAD:', digit);

  if (digit === '#') session.page = Math.min(session.page + 1, story.pages.length - 1);
  else if (digit === '*') session.page = Math.max(session.page - 1, 0);
  else io.emit('effect', { key: digit });

  io.emit('keypad', { digit });
  broadcastState();
});

// ---------- recording saved ----------
app.post('/voice/recording', (req, res) => {
  res.sendStatus(200);
  const r = req.body || {};
  console.log('RECORDING saved:', r.recording_url);
  session.recordings.push({
    url: r.recording_url,
    uuid: r.recording_uuid,
    start: r.start_time,
    end: r.end_time,
    size: r.size,
  });
  io.emit('recording', { count: session.recordings.length });
  broadcastState();
});

// ---------- AR world -> parent's ear (TTS on the parent's leg only) ----------
app.post('/api/say', async (req, res) => {
  const text = (req.body?.text || '').slice(0, 200);
  if (!session.parentLeg) return res.status(409).json({ error: 'no parent on the line' });
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    await vonage.voice.playTTS(session.parentLeg, { text, language: 'en-US' });
    console.log('Said to parent:', text);
    res.json({ ok: true });
  } catch (e) {
    console.error('playTTS failed:', e?.response?.data || e.message);
    res.status(500).json({ error: 'tts failed' });
  }
});

app.get('/api/state', (req, res) =>
  res.json({ ...session, story: { title: story.title, pages: story.pages.length } })
);
app.get('/api/story', (req, res) => res.json(story));

io.on('connection', (socket) => {
  console.log('XR client connected');
  socket.emit('state', {
    page: session.page,
    totalPages: story.pages.length,
    inCall: !!session.parentLeg,
    recordings: session.recordings.length,
  });
});

server.listen(port, () => console.log(`Once Upon a Call listening on ${port}`));
