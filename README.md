# Once Upon a Call 📖📞

**A live AR bedtime story, read over any phone.**

Some parents can't be home at bedtime — and the only thing they have is a plain phone. A soldier on deployment. A mom in a hospital bed. A dad working abroad. A parent in jail. No video, no app, no internet. Just a number they can dial.

Once Upon a Call turns that phone call into a *presence*. The parent dials in from any phone on Earth. In the child's room (AR headset, or a laptop/phone in fallback), the parent appears beside the bed with a floating storybook. As they read, the words light up. When they press **#** on their keypad, the page turns. When they press **1**, the dragon roars. The child taps a star and the parent hears, in their ear only: *"Maya just sent you a big hug."* Every story is recorded, so on nights the parent can't call, the child can replay it — pages turning in time with their voice.

Built for the **DIALED IN Builder Challenge** (CreateHER Fest × Vonage), Washington DC cohort.
Lenses: **Access** and **Connection** (with a good helping of Play).

---

## Why this matters

| Who | Scale | What they have today |
|---|---|---|
| Children with an incarcerated parent | ~2.7 M in the US (1 in 28) [[1]](#references) | 15-min voice calls; recorded-story programs mailed on CD weeks later |
| Children with a deployed parent | ~250 K per year; "40 million missed stories a year" [[2]](#references) | Pre-recorded video via United Through Reading story stations |
| Children of hospitalized / overseas-working parents | — | Video calls *if* both sides have devices, data, and privacy |

Family contact is not a nicety: in the Minnesota DOC study of 16,400 people, any family visit cut felony re-conviction by **13 %** [[3]](#references), and frequent phone contact lowers parenting stress and improves post-release attachment [[4]](#references). Pennsylvania's DOC spent **$680 K** on VR family visits [[5]](#references) — proof of institutional demand — but their model needs a headset *inside* the facility. Ours needs only the phone the parent already has.

Existing products (Caribu, Readeo, Storybook Dads, United Through Reading) are either **video on both ends** or **recorded and one-way**. Nothing is live, two-way, and phone-only on the parent's side. That's the gap.

---

## How it works

```
Parent's phone ──PSTN──▶ Vonage number (+1 201 890 3507)
                          │  NCCO: talk (welcome) → [input PIN if not approved] → record → connect{app}
                          ▼
                 Child's WebXR app (Vonage Client SDK leg, XR Blocks)
                          │
   Vonage async DTMF ─────┼──▶ /voice/dtmf ──▶ socket.io ──▶ page turn / effect in AR
   Parent's audio  ───────┼──▶ lip-synced avatar  +  Deepgram streaming ASR ──▶ words light up
   Child taps ⭐  ────────┼──▶ /api/say ──▶ PUT /calls/{parentLeg}/talk ──▶ only the parent hears it
   Hang-up ───────────────┴──▶ /voice/recording ──▶ mp3 downloaded ──▶ Replay mode (+ SMS to caregiver)
```

### Vonage Voice API features used (and why)

| Feature | Where | Purpose |
|---|---|---|
| **Client SDK in-app voice** | `static/VonageAudioCall.js`, `/token` | The child's XR app is a call leg; the WebRTC stream drives the lip-sync avatar |
| **NCCO `talk`** | `/voice/answer` | Welcome + keypad instructions for a screenless caller |
| **NCCO `input` (DTMF)** | `/voice/answer`, `/voice/pin` | Family PIN gate for numbers not on the allow-list — child safety |
| **NCCO `record`** | `/voice/answer`, `/voice/recording` | Every story becomes a keepsake |
| **Asynchronous DTMF** (`PUT /calls/{uuid}/input/dtmf`) | `subscribeDTMF`, `/voice/dtmf` | A 1970s keypad becomes an AR controller: `#` next page, `*` back, `1-3` effects |
| **Per-leg TTS** (`PUT /calls/{uuid}/talk`) | `/api/say` | The AR world talks back *only* into the parent's ear |
| **Recording download** | `downloadRecording` | Replay without exposing credentials to the browser |
| **Messages API** (optional) | `/voice/recording` | Caregiver SMS when a story is saved |

### Other tech
- **XR Blocks** (Google) — WebXR framework from the workshop: spatial panels, hand/mouse interaction, depth, desktop simulator. Pinned to build `595aeb64` (pre-0.20 API).
- **three.js** canvas-textured storybook with procedural illustrations (no assets to load).
- **Deepgram** streaming ASR (optional) for word-by-word highlighting.
- **socket.io** for server → XR events.

---

## Run it

Prerequisites: a Vonage API account with a voice-enabled number, Node 20+.

```bash
git clone https://github.com/usv240/createher-vonage-webxr-workshop once-upon-a-call
cd once-upon-a-call
npm install
cp .env.example .env      # fill in Vonage app id, private key (base64), number
npm start                 # http://localhost:3000
```

Vonage must be able to reach your server. On GitHub Codespaces the public URL is derived automatically (make port 3000 **Public**). Locally, run `ngrok http 3000` and set `PUBLIC_URL`. Point your Vonage application's **answer** webhook to `<PUBLIC_URL>/voice/answer` (GET) and **event** webhook to `<PUBLIC_URL>/voice/event` (POST) — the included `setup-project.js` does this for Codespaces.

Optional `.env`:
```
APPROVED_NUMBERS=17045551234,17045556789   # who may enter the child's room
FAMILY_PIN=2468                             # everyone else is asked for this
CAREGIVER_NUMBER=17045551234                # SMS when a story is saved
DEEPGRAM_API_KEY=...                        # live word highlighting
```

Handy URL parameters: `?gain=3` makes the parent's voice louder (`?gain=1` turns the boost off),
`?dist=0.9` brings the storybook closer, which helps when filming on a large monitor.

### Using it
1. Open the app, allow the microphone, click **OPEN THE STORYBOOK** (headset: enters AR; laptop: XR Blocks simulator).
2. From any phone, call the Vonage number. Answer in the app.
3. Parent reads. **#** turns the page, **\*** goes back, **1/2/3** trigger surprises.
4. Child taps **⭐ Hug** (or any message) — the parent hears it.
5. Hang up → the story is saved. **Replay last story** plays it back with page turns and highlights in sync.

---

## Project layout

```
index.js                  Express + socket.io server, all Vonage webhooks and APIs
static/VonageAudioCall.js XR Blocks script: call UI, avatar, storybook wiring, replay
static/Storybook.js       Canvas-textured AR book: text highlighting + living illustration
static/StoryListener.js   Deepgram streaming ASR from the call's remote stream + reading tracker
static/story.json         The story (pages, keyword → effect map, keypad effects)
static/main.js            XR Blocks bootstrap
pages/index.html          Import map (XR Blocks pinned), Client SDK, socket.io
```

## Testing the overlay

The landing overlay sits on top of a live 3D scene, so its layout is checked in a real browser
rather than by eye. `test/layout.test.js` loads the page at 390px, 1280px, 1920px and 3840px
wide, in both the expanded-guide and compact-top-bar states, and fails if any two blocks overlap,
anything is `position: fixed`, anything overflows the viewport, or the compact bar grows past a
thin strip.

```bash
npm start                 # in one terminal
npm i -D puppeteer-core   # drives the Chrome already on your machine, no download
node test/layout.test.js http://localhost:3000/
```

It writes `expanded.png` / `compact.png` for a visual check. Edit `CHROME` at the top of the
file if your Chrome lives somewhere else.

## Safety & privacy
- Only approved numbers (or callers with the family PIN) can enter the child's room.
- Recordings stay on the family's server; they are never sent to third parties. The optional ASR key is only used on the child's device for the parent's audio.
- No secrets in the repo (`.env`, `private.key`, `recordings/` are git-ignored).

## Path to the real world
- **Pilot partners**: United Through Reading (300+ story stations on bases), Storybook Dads / Project Bedtime Story (prison reading programs), children's hospitals' child-life departments.
- **Where it runs**: any WebXR device (Android XR, Quest browser) or a plain laptop/phone — the *child's* side can be a $150 tablet; the *parent's* side is any phone, including institutional phone systems that allow approved numbers.
- **Next**: multiple families (per-child rooms keyed by the number dialed), a library of licensed picture books, illustrator-drawn scenes, accessibility captions for hard-of-hearing children (the ASR is already there), and a Vonage Verify flow for caregivers to approve new callers by SMS.

## References
1. The Sentencing Project, *Parents in Prison* (2022). https://www.sentencingproject.org/app/uploads/2022/09/Parents-in-Prison.pdf
2. United Through Reading, *Our Impact*. https://unitedthroughreading.org/about/our-impact/
3. Minnesota Department of Corrections, *The Effects of Prison Visitation on Offender Recidivism* (2011). https://mn.gov/doc/assets/11-11PrisonVisitationResearchinBrief-Final_tcm1089-272782.pdf
4. Poehlmann-Tynan et al., *Young Children's Contact with their Parents in Jail and Child Behavior Problems*. https://pmc.ncbi.nlm.nih.gov/articles/PMC11449473/
5. Pennsylvania DOC, *Virtual Reality Technology to Augment Programming for Incarcerated Parents and Their Children*. https://www.pa.gov/agencies/cor/about-us/newsroom/newsroom/department-of-corrections-introduces-virtual-reality-technology-to-augment-programming-for-incarcerated-parents-and-their-children
6. Vonage Voice API docs — WebSockets, DTMF, NCCO reference. https://developer.vonage.com/en/voice/voice-api/overview
7. Google XR Blocks. https://xrblocks.github.io/

## License
MIT — built on the CreateHER Fest × Vonage WebXR workshop starter by Dwane Hemmings.
