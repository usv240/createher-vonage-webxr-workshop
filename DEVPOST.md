# Devpost submission copy

## Project name
Once Upon a Call

## Tagline
A live AR bedtime story, read over any phone — for every parent who can only phone home.

## Lens explored
**Access** (a plain phone becomes a way into a child's world) and **Connection** (the parent is *in the room*, not in a handset). Play shows up in the keypad-controlled illustrations.

## Inspiration
2.7 million US kids have a parent in jail or prison tonight. 250,000 more have a parent deployed. Add hospital stays and overseas work, and you get a huge group of parents whose only channel home is a plain voice call — often from a payphone or a landline with no screen at all. Existing "read to your kid remotely" apps need video on both ends; prison and military programs mail a recorded CD weeks later. We wanted the parent to be *present*, live, tonight, from the phone they already have.

## What it does
The parent dials a phone number. In the child's bedroom (AR headset, or a tablet/laptop in fallback), the parent appears as a lip-synced avatar next to a floating storybook. As they read, the words light up. Pressing **#** on their keypad turns the page, **\*** goes back, and **1/2/3** make the dragon roar, the stars twinkle, the moon hum. The child taps a star and the parent hears — in their ear only — *"Maya just sent you a big hug."* Every story is recorded and can be replayed with the page turns and highlights in sync, for nights when the parent can't call. Callers not on the family list are asked for a family PIN.

## How we built it
- **Vonage Voice API** — Client SDK in-app leg (the XR app answers the call), NCCO `talk`/`input`/`record`/`connect`, **asynchronous DTMF** subscription so keypad presses arrive as webhooks mid-call, **per-leg text-to-speech** (`PUT /calls/{uuid}/talk`) so the child's messages are heard by the parent only, recording download for replay, optional Messages API SMS to the caregiver.
- **XR Blocks + three.js** — spatial panels and avatar from the DIALED IN workshop; a canvas-textured storybook with procedural illustrations that react to keywords and keypad.
- **Deepgram streaming ASR** on the parent's audio stream (forked from the same WebRTC stream that drives the lip-sync) for word-by-word highlighting.
- Node/Express + socket.io server, GitHub Codespaces for public webhooks.

## Challenges
XR Blocks shipped a breaking release (v0.20) days after the workshop — `SpatialPanel` and the simulator add-on disappeared from the CDN, so the workshop code stopped loading. We pinned to the exact August build and moved on. Vonage's async-DTMF webhook payload isn't documented in detail, so the handler is written to tolerate several shapes. And we designed the whole thing so it degrades gracefully: no headset → simulator; no ASR key → no highlighting but everything else works.

## Accomplishments
A phone keypad from any decade controls an AR scene. The AR scene talks back down the phone line. A parent with nothing but a phone can read a picture book *with* their child, not *at* a recorder.

## What we learned
The Voice API's "boring" primitives — DTMF, per-leg TTS, record — are the ones that reach the most people, because they work on every phone ever made.

## What's next
Pilot with United Through Reading and prison family-literacy programs; per-family rooms keyed by dialed number; licensed picture books; caregiver approval of new callers via Vonage Verify; captions for hard-of-hearing children.

## Vonage Voice API features used
Client SDK (in-app voice), NCCO talk / input (DTMF) / record / connect, asynchronous DTMF events, per-leg TTS (`/talk`), recording download, Messages API (SMS).
