// Storybook.js — an AR picture book drawn on a canvas texture.
// Left page: a living illustration (procedural, no assets to load).
// Right page: the story text, with words lighting up as the parent reads them.
//
// Public API (used by VonageAudioCall.js):
//   book.setPage(i)              -> show page i (0-based)
//   book.highlightUpTo(n)        -> first n words of the page glow
//   book.trigger(effectName)     -> run an illustration effect ('dragon-fly', 'stars-twinkle', ...)
//   book.setBanner(text)         -> small caption under the book ("Dad is reading...")
//   book.update(dt)              -> call every frame
import * as THREE from 'three';

const W = 1600;   // canvas px (two pages side by side)
const H = 1000;
const PAGE_W = 1.15; // metres
const PAGE_H = PAGE_W * (H / W);

export class Storybook extends THREE.Group {
  constructor(story) {
    super();
    this.story = story;
    this.pageIndex = 0;
    this.spoken = 0;
    this.banner = '';
    this.effects = {};        // name -> remaining seconds
    this.time = 0;
    this.flip = 0;            // page-turn animation 0..1

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H), mat);
    this.add(this.mesh);

    // A soft "cover" behind the pages so it reads as a book in AR
    const cover = new THREE.Mesh(
      new THREE.PlaneGeometry(PAGE_W + 0.04, PAGE_H + 0.04),
      new THREE.MeshStandardMaterial({ color: 0x7a3e2f, roughness: 0.9 })
    );
    cover.position.z = -0.005;
    this.add(cover);

    // Floating star the child can "send" (decorative — the button does the sending)
    this.star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.035, 0),
      new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffb300, emissiveIntensity: 0.8 })
    );
    this.star.position.set(PAGE_W / 2 + 0.12, PAGE_H / 2, 0.02);
    this.add(this.star);

    this.draw();
  }

  get page() {
    return this.story.pages[this.pageIndex];
  }

  get words() {
    return this.page.text.split(/\s+/);
  }

  setPage(i) {
    const next = Math.max(0, Math.min(i, this.story.pages.length - 1));
    if (next !== this.pageIndex) this.flip = 1;
    this.pageIndex = next;
    this.spoken = 0;
    this.effects = {};
    this.draw();
  }

  highlightUpTo(n) {
    this.spoken = Math.max(0, Math.min(n, this.words.length));
    this.draw();
  }

  trigger(name, seconds = 2.5) {
    this.effects[name] = seconds;
  }

  setBanner(text) {
    this.banner = text;
    this.draw();
  }

  // Live caption of what the parent just said (accessibility for hard-of-hearing children)
  setCaption(text) {
    this.caption = String(text || '').slice(-90);
    this.draw();
  }

  update(dt) {
    this.time += dt;
    let dirty = false;
    for (const k of Object.keys(this.effects)) {
      this.effects[k] -= dt;
      if (this.effects[k] <= 0) delete this.effects[k];
      dirty = true;
    }
    if (this.flip > 0) {
      this.flip = Math.max(0, this.flip - dt * 3);
      this.mesh.scale.x = 0.2 + 0.8 * (1 - this.flip);
      dirty = true;
    }
    // Always-on gentle motion (stars twinkle, dragon breathes) at low cost: redraw ~12 fps
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 1 / 12) {
      this._acc = 0;
      dirty = true;
    }
    this.star.rotation.y += dt * 1.5;
    this.star.position.y = PAGE_H / 2 + Math.sin(this.time * 2) * 0.01;
    if (dirty) this.draw();
  }

  // ---------------- drawing ----------------
  draw() {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);

    // paper
    c.fillStyle = '#fbf5e6';
    this.roundRect(c, 0, 0, W, H, 28);
    c.fill();
    // spine shadow
    const g = c.createLinearGradient(W / 2 - 40, 0, W / 2 + 40, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(W / 2 - 40, 0, 80, H);

    this.drawIllustration(c, 60, 60, W / 2 - 120, H - 200);
    this.drawText(c, W / 2 + 70, 110, W / 2 - 150);

    // page number + banner
    c.fillStyle = '#8a7b63';
    c.font = '32px Georgia, serif';
    c.textAlign = 'right';
    c.fillText(`${this.pageIndex + 1} / ${this.story.pages.length}`, W - 60, H - 50);
    c.textAlign = 'left';
    c.font = 'italic 34px Georgia, serif';
    c.fillStyle = '#6b5b45';
    c.fillText(this.banner, 70, H - 50);

    // caption strip (what the parent just said), right page bottom
    if (this.caption) {
      c.fillStyle = 'rgba(26,26,46,0.85)';
      this.roundRect(c, W / 2 + 60, H - 150, W / 2 - 120, 70, 14);
      c.fill();
      c.fillStyle = '#fff7e6';
      c.font = '30px system-ui, sans-serif';
      c.textBaseline = 'middle';
      c.fillText('“' + this.caption + '”', W / 2 + 80, H - 115);
      c.textBaseline = 'top';
    }

    this.texture.needsUpdate = true;
  }

  drawText(c, x, y, maxW) {
    const words = this.words;
    c.font = '54px Georgia, serif';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    const lineH = 78;
    let cx = x, cy = y;
    words.forEach((w, i) => {
      const width = c.measureText(w + ' ').width;
      if (cx + width > x + maxW) {
        cx = x;
        cy += lineH;
      }
      if (i < this.spoken) {
        // glow behind spoken words
        c.fillStyle = i === this.spoken - 1 ? 'rgba(255,196,0,0.55)' : 'rgba(255,226,120,0.45)';
        this.roundRect(c, cx - 6, cy - 6, width - 4, lineH - 14, 12);
        c.fill();
        c.fillStyle = '#2b1d0e';
      } else {
        c.fillStyle = '#5c4a33';
      }
      c.fillText(w, cx, cy);
      cx += width;
    });
    // title on page 1
    if (this.pageIndex === 0) {
      c.font = 'bold 40px Georgia, serif';
      c.fillStyle = '#a0522d';
      c.fillText(this.story.title, x, y - 70);
    }
  }

  drawIllustration(c, x, y, w, h) {
    const t = this.time;
    const scene = this.page.scene;
    const fx = this.effects;

    // sky
    const night = c.createLinearGradient(0, y, 0, y + h);
    const dim = fx['lights-dim'] ? 0.5 : 1;
    night.addColorStop(0, scene === 'sleep' ? '#0b1030' : '#1b2a5a');
    night.addColorStop(1, scene === 'cave' ? '#3b2a1a' : '#2c3e7a');
    c.fillStyle = night;
    this.roundRect(c, x, y, w, h, 24);
    c.fill();
    c.globalAlpha = dim;

    // stars
    const n = scene === 'cave' ? 12 : 40;
    for (let i = 0; i < n; i++) {
      const sx = x + ((i * 97) % (w - 40)) + 20;
      const sy = y + ((i * 57) % (h / 2)) + 20;
      const tw = fx['stars-twinkle'] ? 0.5 + 0.5 * Math.sin(t * 12 + i) : 0.6 + 0.4 * Math.sin(t * 2 + i);
      c.fillStyle = `rgba(255,255,220,${tw})`;
      c.beginPath();
      c.arc(sx, sy, 3 + (i % 3), 0, Math.PI * 2);
      c.fill();
    }

    // moon
    if (scene === 'moon' || scene === 'sleep' || scene === 'stars') {
      const mx = x + w * 0.75, my = y + h * 0.22;
      c.fillStyle = '#fff3b0';
      c.beginPath();
      c.arc(mx, my, 70, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = scene === 'sleep' ? '#0b1030' : '#1b2a5a';
      c.beginPath();
      c.arc(mx - 28, my - 12, 58, 0, Math.PI * 2);
      c.fill();
      if (fx['moon-smile'] || scene === 'sleep') {
        c.strokeStyle = '#a58a3c';
        c.lineWidth = 5;
        c.beginPath();
        c.arc(mx + 20, my + 10, 22, 0.15 * Math.PI, 0.85 * Math.PI);
        c.stroke();
      }
    }

    // hill / cave
    c.fillStyle = scene === 'cave' ? '#4a3524' : '#22335f';
    c.beginPath();
    c.ellipse(x + w / 2, y + h + 40, w * 0.7, h * 0.35, 0, Math.PI, 0);
    c.fill();
    if (scene === 'cave') {
      c.fillStyle = fx['cave-glow'] ? '#ffb347' : '#1a120b';
      c.beginPath();
      c.ellipse(x + w * 0.5, y + h * 0.78, 110, 80, 0, Math.PI, 0);
      c.fill();
    }

    // dragon
    const fly = fx['dragon-fly'] ? 1 : 0;
    const wig = fx['dragon-wiggle'] ? Math.sin(t * 20) * 8 : 0;
    const baseX = x + w * 0.45 + (fly ? Math.sin(t * 3) * 60 : 0);
    const baseY = y + h * (fly ? 0.35 + 0.1 * Math.sin(t * 4) : 0.72) + Math.sin(t * 2) * 4;
    this.drawDragon(c, baseX + wig, baseY, fly, fx['eyes-close'] || scene === 'sleep', fx['roar']);

    c.globalAlpha = 1;
  }

  drawDragon(c, x, y, flying, eyesClosed, roaring) {
    c.save();
    c.translate(x, y);
    // wings
    c.fillStyle = '#6fbf73';
    const flap = flying ? Math.sin(this.time * 14) * 30 : Math.sin(this.time * 2) * 5;
    c.beginPath();
    c.moveTo(-10, -20);
    c.quadraticCurveTo(-90, -80 - flap, -110, -10 + flap / 2);
    c.quadraticCurveTo(-60, -20, -10, 0);
    c.fill();
    c.beginPath();
    c.moveTo(10, -20);
    c.quadraticCurveTo(90, -80 - flap, 110, -10 + flap / 2);
    c.quadraticCurveTo(60, -20, 10, 0);
    c.fill();
    // body
    c.fillStyle = '#4caf50';
    c.beginPath();
    c.ellipse(0, 10, 55, 42, 0, 0, Math.PI * 2);
    c.fill();
    // belly
    c.fillStyle = '#c8e6c9';
    c.beginPath();
    c.ellipse(0, 22, 30, 22, 0, 0, Math.PI * 2);
    c.fill();
    // head
    c.fillStyle = '#4caf50';
    c.beginPath();
    c.arc(0, -40, 34, 0, Math.PI * 2);
    c.fill();
    // eyes
    c.fillStyle = '#1b1b1b';
    if (eyesClosed) {
      c.lineWidth = 4;
      c.strokeStyle = '#1b1b1b';
      c.beginPath(); c.moveTo(-18, -44); c.lineTo(-6, -44); c.stroke();
      c.beginPath(); c.moveTo(6, -44); c.lineTo(18, -44); c.stroke();
    } else {
      c.beginPath(); c.arc(-12, -44, 5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(12, -44, 5, 0, Math.PI * 2); c.fill();
    }
    // mouth / roar
    if (roaring) {
      c.fillStyle = '#ff7043';
      c.beginPath();
      c.ellipse(0, -24, 14, 10, 0, 0, Math.PI * 2);
      c.fill();
      // little flame
      c.fillStyle = 'rgba(255,152,0,0.9)';
      c.beginPath();
      c.moveTo(14, -24);
      c.lineTo(70 + Math.sin(this.time * 30) * 10, -34);
      c.lineTo(60, -20);
      c.lineTo(75, -12);
      c.lineTo(14, -18);
      c.fill();
    } else {
      c.strokeStyle = '#1b1b1b';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(0, -30, 10, 0.1 * Math.PI, 0.9 * Math.PI);
      c.stroke();
    }
    // tiny horns
    c.fillStyle = '#ffd54a';
    c.beginPath(); c.moveTo(-22, -62); c.lineTo(-14, -80); c.lineTo(-8, -60); c.fill();
    c.beginPath(); c.moveTo(22, -62); c.lineTo(14, -80); c.lineTo(8, -60); c.fill();
    c.restore();
  }

  roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
}
