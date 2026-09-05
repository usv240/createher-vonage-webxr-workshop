# Demo video script (target 3:30 – 4:30, max 5:00)

**Setup for filming**
- Laptop running the app in Chrome (XR Blocks simulator), screen-recorded (OBS or Windows Game Bar).
- Your phone in frame on a second camera/phone, or picture-in-picture. Ideally an *old* phone (flip phone / landline handset) for the reach shot.
- Bedroom-ish backdrop or a stuffed animal on the desk. Keep it warm; this is a bedtime story.
- Terminal visible for one short cut (judges want to see the Voice API doing the work).

---

**0:00 – 0:25 — The problem (voice-over, on-screen text)**
> "2.7 million kids in the US have a parent in prison tonight. 250,000 have a parent deployed. For all of them, the only thing that reaches home is a plain phone call. No video. No app. Just a voice in a handset."
Show: three still frames — payphone, ship satellite phone, hospital bedside phone.

**0:25 – 0:45 — The idea**
> "Once Upon a Call turns that phone call into a bedtime story the child can *see*. The parent needs nothing but a phone. The child sees them appear in the room, with a storybook."
Show: title card + the AR book in the app.

**If anything goes wrong on the day:** press **▶ Watch the story**. The narrated tour drives the
same page-turn, highlight and effect code as a live call, so you can film the whole experience
even if the network, the Codespace or the phone lets you down. Never film a broken take.

**0:45 – 1:10 — The call**
Screen: app open, "Waiting for a story call…". Phone in frame: dial the Vonage number.
Phone audio (let it play): *"Welcome to Once Upon a Call. Opening Maya's storybook. Press pound to turn the page…"*
Click answer. Avatar appears beside the book; mouth moves as you talk.
> "That's a real PSTN call through the Vonage Voice API, answered by the Vonage Client SDK inside a WebXR app built with XR Blocks."

**1:10 – 1:50 — Reading + highlighting**
Read page 1 aloud. Words light up; say "dragon" → dragon wiggles.
> "The parent's audio drives the lip-sync avatar *and* a live transcription, so the words light up as they're read, and the illustration listens for the story's key words."

**1:50 – 2:30 — The keypad trick (the "surprise")**
Press **#** on the phone — page turns. Press **1** — dragon roars. Press **\*** — back.
Cut to terminal for 3 seconds: `KEYPAD: #` lines.
> "No screen on the parent's side, ever. Vonage's asynchronous DTMF turns a 1970s keypad into an AR controller."

**2:30 – 3:00 — The child talks back**
Click **⭐ Hug**. Put the phone to the camera: it says *"Maya just sent you a big hug."*
> "And the room talks back — text-to-speech played into the parent's leg only, so it's private to them."

**3:00 – 3:30 — Safety + keepsake**
Quick cut: an unknown number calls → *"Please enter your family PIN."*
Hang up the story call → terminal `RECORDING downloaded`. Click **Replay last story** → pages turn in sync with the recording.
> "Only approved numbers or the family PIN get into the child's room. Every story is saved, so on nights the parent can't call, the child still gets their voice."

**3:30 – 4:00 — Why it's real**
On-screen: MN DOC 13 % recidivism stat, PA DOC $680K VR program, United Through Reading 300 story stations.
> "Family contact measurably reduces re-offending. States are already paying for VR visits that need a headset inside the facility. Ours needs only the phone the parent already has. Pilot partners: United Through Reading, Storybook Dads, children's hospitals."

**4:00 – 4:15 — Close**
> "Once Upon a Call. Redefining who gets to say goodnight. Built with the Vonage Voice API and XR Blocks for CreateHER Fest's DIALED IN challenge."
GitHub link on screen.

---

**Shot checklist**
- [ ] Phone dialing, audible welcome prompt
- [ ] Avatar mouth moving with your voice
- [ ] Words highlighting (needs DEEPGRAM_API_KEY)
- [ ] `#` page turn + `1` roar, with terminal `KEYPAD:` cut
- [ ] Hug heard on the phone
- [ ] PIN prompt from a second phone (or set APPROVED_NUMBERS to exclude your phone for one take)
- [ ] Replay mode
- [ ] (Backup take) ▶ Watch the story narrated tour
- [ ] Live captions visible under the illustration
- [ ] Stats card + GitHub link
