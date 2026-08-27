import * as THREE from 'three';
import * as xb from 'xrblocks';
import { LipsyncMouth } from 'lipsync';
import { Keyboard } from 'xrblocks/addons/virtualkeyboard/Keyboard.js';

// ⌄⌄⌄ Set Quick Replies ⌄⌄⌄
const QUICK_REPLIES = [
  { label: 'Hug', message: 'Maya just sent you a big hug.' },
  { label: 'Again!', message: 'Maya says: read that page again, please!' },
  { label: 'One more', message: 'Maya says: one more page, please!' },
  { label: 'Night', message: 'Maya says: goodnight, I love you.' },
];
export class VonageAudioCall extends xb.Script {
  // ⌄⌄⌄ Create constructor ⌄⌄⌄
  constructor() {
    super();
    this.token = '';
    this.client = new vonageClientSDK.VonageClient();
    this.callId = null;
    // Keep a reference to the panel so we can destroy it later
    this.panel = null;
    this.statusText = null;
    this.userName = "XR_User_1";
    this.grid = null;
    this.controlRow = null;
    this.puppetHead = null;
    this.face = null;
    this.mouth = null;
    this._camWorld = new THREE.Vector3();
    this._headWorld = new THREE.Vector3();
    this.replyPanel = null;
    this.typedTextView = null;
    this._currentTypedText = '';
    this.keyboard = null;
  }
  // ⌄⌄⌄ Create 3D Avatar ⌄⌄⌄
  _createAvatar(stream) {
    // Safety: don't create a second avatar if one already exists
    if (this.puppetHead) return;

    console.log("Creating lipsync avatar...");

    const faceR = 0.1;

    const head = new THREE.Group();
    // Position: in front of the user, roughly at face height
    head.position.set(0, xb.user.height, -1.2);

    // --- Sphere face mesh ---
    const faceGeom = new THREE.SphereGeometry(faceR, 32, 24);
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xf2d4b3,
      roughness: 0.6,
      metalness: 0.05,
    });
    const faceMesh = new THREE.Mesh(faceGeom, faceMat);
    head.add(faceMesh);

    this.face = new xb.StylizedFace({ showEyes: true });
    head.add(this.face);

    this.mouth = new LipsyncMouth(stream, { target: this.face });
    head.add(this.mouth);

    this.puppetHead = head;
    this.add(head);
  }
  // ⌄⌄⌄ Remove 3D Avatar ⌄⌄⌄
  _removeAvatar() {
    if (!this.puppetHead) return;

    console.log("Removing lipsync avatar...");

    if (this.mouth) {
      // Detach from the head group before nulling the reference
      this.mouth.parent?.remove(this.mouth);
      this.mouth = null;
    }

    if (this.face) {
      this.face.parent?.remove(this.face);
      // dispose() frees the underlying canvas/texture to avoid memory leaks
      this.face.dispose();
      this.face = null;
    }

    this.remove(this.puppetHead);
    this.puppetHead = null;
  }
  // ⌄⌄⌄ Create Call panel ⌄⌄⌄
  _createCallPanel(callerName) {
    // SAFETY: If a panel already exists, don't create another one.
    if (this.panel) return;

    console.log("Creating Call UI...");

    // 1. Create the Panel
    this.panel = new xb.SpatialPanel({ backgroundColor: '#2b2b2baa' });
    this.panel.position.set(
      0,
      xb.user.height - 0.5,
      -xb.user.objectDistance
    );

    this.add(this.panel);

    this.grid = this.panel.addGrid();

    // 2. Status Text
    this.statusText = this.grid.addRow({ weight: 0.7 }).addText({
      text: `Incoming call from ${callerName}...`,
      fontColor: '#ffffff',
      fontSize: 0.08,
    });

    this.updateControlRow('INCOMING');
  }
  // ⌄⌄⌄ Update Call controls ⌄⌄⌄
  updateControlRow(state) {
    if (!this.grid) return;

    // 1. Remove the existing row if it exists
    if (this.controlRow) {
      this.grid.remove(this.controlRow);
      this.controlRow = null;
      this.grid.resetLayout();
    }

    // 2. Create a fresh row. It will naturally append below the Status Text.
    // We give it the full remaining weight (0.3 relative to the panel, or flexible)
    this.controlRow = this.grid.addRow({ weight: 0.3 });

    if (state === 'INCOMING') {
      // --- ANSWER BUTTON ---
      const answerBtn = this.controlRow.addCol({ weight: 0.5 }).addIconButton({
        text: 'call',
        fontSize: 0.5,
        backgroundColor: '#00ff00'
      });
      answerBtn.onTriggered = () => this._onAnswer();

      // --- REJECT BUTTON ---
      const rejectBtn = this.controlRow.addCol({ weight: 0.5 }).addIconButton({
        text: 'call_end',
        fontSize: 0.5,
        backgroundColor: '#ff0000'
      });
      rejectBtn.onTriggered = () => this._onReject();

    } else if (state === 'CONNECTED') {
      // --- HANGUP BUTTON ---
      // This is a fresh row, so layouts will calculate correctly
      const hangupBtn = this.controlRow.addCol({ weight: 1 }).addIconButton({
        text: 'call_end',
        fontSize: 0.5,
        backgroundColor: '#ff0000'
      });
      hangupBtn.onTriggered = () => this._onHangup();
    }

    // 3. Force layout update
    this.panel.updateLayouts();
  }
  // ⌄⌄⌄ Remove Call panel ⌄⌄⌄
  _removeCallPanel() {
    if (this.panel) {
      console.log("Destroying Call UI...");
      this.remove(this.panel);
      this.panel = null;
      this.grid = null;
      this.statusText = null;
      this.controlRow = null;
    }
    this._removeReplyPanel();
  }
  // ⌄⌄⌄ Show Virtual Keyboard ⌄⌄⌄
  _showKeyboard() {
    if (this.keyboard) return;

    this.keyboard = new Keyboard();
    // Position it below and aligned with the reply panel
    this.keyboard.position.set(
      0,
      xb.user.height - 1.35,
      -xb.user.objectDistance + 1
    );
    this.add(this.keyboard);

    // Update the display on every keystroke
    this.keyboard.onTextChanged = (text) => {
      this._currentTypedText = text;
      if (this.typedTextView) {
        this.typedTextView.text = text.length > 0 ? text : 'Tap  to type...';
      }
    };

    // Enter key sends immediately — same as tapping the Send button
    this.keyboard.onEnterPressed = (text) => {
      this._sendTypedText();
    };
  }
  // ⌄⌄⌄ Hide Virtual Keyboard ⌄⌄⌄
  _hideKeyboard() {
    if (!this.keyboard) return;
    this.remove(this.keyboard);
    this.keyboard = null;
  }
  // ⌄⌄⌄ Toggle Virtual Keyboard ⌄⌄⌄
  _toggleKeyboard() {
    this.keyboard ? this._hideKeyboard() : this._showKeyboard();
  }
  // ⌄⌄⌄ Send Quick Reply ⌄⌄⌄
  _sendQuickReply(message) {
    if (!this.callId) return;
    console.log(`Sending quick reply: "${message}"`);

    // Give the user immediate visual feedback in the status bar
    if (this.statusText) this.statusText.text = 'Sending...';

    this.client.say(this.callId, message)
      .then(() => {
        console.log('Quick reply sent successfully.');
        if (this.statusText) this.statusText.text = `Sent: "${message}"`;
      })
      .catch(err => {
        console.error('say() error:', err);
        if (this.statusText) this.statusText.text = 'Failed to send message.';
      });
  }
  // ⌄⌄⌄ Send Custom Text ⌄⌄⌄
  _sendTypedText() {
    const text = this._currentTypedText.trim();
    if (!text) return;
    if (!this.callId) return;

    console.log(`Sending typed text: "${text}"`);
    if (this.statusText) this.statusText.text = 'Sending...';

    this.client.say(this.callId, text)
      .then(() => {
        console.log('Typed text sent successfully.');
        if (this.statusText) this.statusText.text = `Sent: "${text}"`;

        // Clear the keyboard buffer and reset the display
        if (this.keyboard) this.keyboard.setText('');
        this._currentTypedText = '';
        if (this.typedTextView) this.typedTextView.text = 'Tap  to type...';
      })
      .catch(err => {
        console.error('say() error:', err);
        if (this.statusText) this.statusText.text = 'Failed to send message.';
      });
  }
  // ⌄⌄⌄ Create Reply panel ⌄⌄⌄
  _createReplyPanel() {
    if (this.replyPanel) return;

    this.replyPanel = new xb.SpatialPanel({
      backgroundColor: '#1a1a2ecc',
      width: .75,
      height: 0.9,
    });
    // Offset to the right so it sits beside the main call panel
    this.replyPanel.position.set(
      0.8,
      xb.user.height - 0.5,
      -xb.user.objectDistance
    );
    this.add(this.replyPanel);

    const grid = this.replyPanel.addGrid();

    grid.addRow({ weight: 0.06 }).addText({
      text: 'Quick Replies',
      fontColor: '#9b9bff',
      fontSize: 0.055,
    });

    const pairs = [
      QUICK_REPLIES.slice(0, 2),   // [ Meeting, Talk Later ]
      QUICK_REPLIES.slice(2, 4),   // [ OMW!, 5 Mins ]
    ];

    pairs.forEach(pair => {
      const row = grid.addRow({ weight: 0.20 });
      pair.forEach(({ label, message }) => {
        const btn = row.addCol({ weight: 0.5 }).addTextButton({
          text: label,
          fontSize: 0.35,
          backgroundColor: '#2e2e50',
          fontColor: '#ffffff',
        });
        btn.onTriggered = () => this._sendQuickReply(message);
      });
    });

    grid.addRow({ weight: 0.06 }).addText({
      text: 'Talk via Text',
      fontColor: '#9b9bff',
      fontSize: 0.055,
    });

    this.typedTextView = grid.addRow({ weight: 0.18 }).addText({
      text: 'Tap to type...',
      fontColor: '#ffffff',
      fontSize: 0.065,
      textAlign: 'left',
    });

    const actionRow = grid.addRow({ weight: 0.30 });

    const kbBtn = actionRow.addCol({ weight: 0.5 }).addIconButton({
      text: 'keyboard',
      fontSize: 0.5,
      backgroundColor: '#2e3a4a',
    });
    kbBtn.onTriggered = () => this._toggleKeyboard();

    const sendBtn = actionRow.addCol({ weight: 0.5 }).addIconButton({
      text: 'send',
      fontSize: 0.5,
      backgroundColor: '#1a4a2a',
    });
    sendBtn.onTriggered = () => this._sendTypedText();

    this.replyPanel.updateLayouts();
  }
  // ⌄⌄⌄ Remove Reply panel ⌄⌄⌄
  _removeReplyPanel() {
    this._hideKeyboard();
    if (this.replyPanel) {
      this.remove(this.replyPanel);
      this.replyPanel = null;
      this.typedTextView = null;
    }
    this._currentTypedText = '';
  }
  // ⌄⌄⌄ Answer call method ⌄⌄⌄
  _onAnswer() {
    console.log('Answering...');
    this.client.answer(this.callId)
      .then(() => {
        console.log("Success answering call.");
        this.statusText.text = `Call answered.`;
        this.updateControlRow('CONNECTED');

        // ⌄⌄⌄ Show reply panel alongside the call panel ⌄⌄⌄
        this._createReplyPanel();

        // get media stream
        const audioElement = this.client.getAudioOutputElement();
        if (audioElement && audioElement.srcObject) {
          // This is the active WebRTC MediaStream managed by Vonage
          const remoteStream = audioElement.srcObject;
          console.log('remoteStream: ', remoteStream);

          // Example: Grab individual audio tracks from the stream
          const audioTracks = remoteStream.getAudioTracks();
          console.log("Active Audio Tracks:", audioTracks);

          // ⌄⌄⌄ Spin up the lipsync avatar driven by the remote stream ⌄⌄⌄
          this._createAvatar(remoteStream);
        }
      })
      .catch(error => {
        console.error("Error answering call: ", error);
      });
  }
  // ⌄⌄⌄ Reject call method ⌄⌄⌄
  _onReject() {
    console.log('Rejecting...');
    this.client.reject(this.callId)
      .then(() => {
        console.log("Success rejecting call.");
      })
      .catch(error => {
        console.error("Error rejecting call: ", error);
      });
    this._removeCallPanel();
    this._removeAvatar();
  }
  // ⌄⌄⌄ Hang Up call method ⌄⌄⌄
  _onHangup() {
    console.log('Hanging up...');
    this.client.hangup(this.callId)
      .then(() => {
        console.log("Success hanging up call.");
      })
      .catch(error => {
        console.error("Error hanging up call: ", error);
      });
    // We manually destroy the panel here too, just in case the event lags
    this._removeCallPanel();
    this._removeAvatar();
  }
  // ⌄⌄⌄ Set Up Vonage Listeners ⌄⌄⌄
  setupVonageListeners() {
    // --- CREATE UI ON INVITE ---
    this.client.on('callInvite', (callId, from, channelType) => {
      this.callId = callId;
      const maskedNumber = from.replace(/\d(?=(?:\D*\d){4})/g, "*")
      console.log(`Incoming call from ${maskedNumber}`);

      // Trigger the UI creation here
      this._createCallPanel(maskedNumber);
    });

    this.client.on('legStatusUpdate', (callId, legId, status) => {
      console.log("status: ", status);
      if (this.statusText) {
        this.statusText.text = `Status: ${status}`;
      }
    });

    // --- REMOVE UI ON CANCEL/HANGUP ---
    this.client.on('callInviteCancel', (callId) => {
      console.log(`Call cancelled: ${callId}`);
      this.callId = null;
      this._removeCallPanel();
      this._removeAvatar();
    });

    this.client.on("callHangup", (callId, callQuality, reason) => {
      console.log(`Call hung up: ${reason}`);
      this.callId = null;
      this._removeCallPanel();
      this._removeAvatar();
    });
  }
  // ⌄⌄⌄ Connect to server to get token ⌄⌄⌄
  async connectToVonage(name) {
    try {
      console.log(`Fetching token for ${name}...`);

      // 1. Fetch the token (AWAIT the result)
      const response = await fetch(`/token?name=${name}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      this.token = data.token;
      console.log("Fetched token successfully.");

      // 2. Create the Session (AWAIT the result)
      const sessionId = await this.client.createSession(this.token);

      console.log("Session created successfully. Session ID:", sessionId);

      // 3. Update UI
      // Instead, update your XR Panel text to show we are ready
      if (this.statusText) {
        this.statusText.text = "Connected. Waiting for calls...";
      }

    } catch (error) {
      console.error("Connection failed:", error);
      if (this.statusText) this.statusText.text = "Connection Failed.";
    }
  }
  // ⌄⌄⌄ Initialize ⌄⌄⌄
  init() {
    console.log("Vonage init!", this.client);
    this.setupVonageListeners();
    this.connectToVonage(this.userName);
    this._connectStorySocket();
  }

  // ⌄⌄⌄ Storybook events from the server (keypad, page, recording) ⌄⌄⌄
  _connectStorySocket() {
    if (typeof io === 'undefined') return console.warn('socket.io client not loaded');
    this.socket = io();
    this.socket.on('state', (s) => {
      console.log('STORY state', s);
      if (this.statusText) this.statusText.text = `Page ${s.page + 1} / ${s.totalPages}`;
    });
    this.socket.on('keypad', ({ digit }) => console.log('KEYPAD from parent phone:', digit));
    this.socket.on('effect', ({ key }) => console.log('EFFECT', key));
    this.socket.on('recording', ({ count }) => console.log('Story saved. Recordings:', count));
    this.socket.on('call:ended', () => console.log('Parent hung up'));
  }

  // the update() method runs per frame. This allows the 3D Avatar to face the user as they move around
  update() {
    const head = this.puppetHead;
    const cam = xb.core?.camera;
    if (!head || !cam) return;

    cam.getWorldPosition(this._camWorld);
    head.getWorldPosition(this._headWorld);

    // Mirror the camera through the head centre so local -Z faces the user
    const targetX = 2 * this._headWorld.x - this._camWorld.x;
    const targetZ = 2 * this._headWorld.z - this._camWorld.z;
    // Clamp Y so the avatar only yaws — it won't pitch if you're taller/shorter
    head.lookAt(targetX, this._headWorld.y, targetZ);
  }
}
