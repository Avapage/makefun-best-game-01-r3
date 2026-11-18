// VOIDHARVEST audio: every sound is synthesized with WebAudio at run time.
// No audio files, no network. A small SFX kit (shots, hits, explosions,
// pickups, UI) plus a procedural music sequencer: an A-minor bass line,
// pad chords and a pentatonic arpeggio scheduled with a lookahead timer.

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = false;
    this._lastShot = 0;
    this._step = 0;
    this._nextNoteTime = 0;
    this._timer = null;
  }

  // Must be called from a user gesture at least once.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.34;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    this.musicBus.connect(lp);
    lp.connect(this.master);
    // Shared noise buffer for percussion and explosions.
    const len = this.ctx.sampleRate * 1;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  tone({ freq = 440, freq2 = null, type = 'sine', dur = 0.15, vol = 0.3, bus = null, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freq2 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(bus || this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.3, vol = 0.4, freq = 1200, q = 0.8, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  shoot() {
    const now = performance.now();
    if (now - this._lastShot < 55) return; // throttle: many guns fire at once
    this._lastShot = now;
    this.tone({ freq: 880, freq2: 320, type: 'square', dur: 0.07, vol: 0.10 });
  }

  seeker() {
    this.tone({ freq: 300, freq2: 900, type: 'sawtooth', dur: 0.16, vol: 0.07 });
  }

  arcZap() {
    this.noise({ dur: 0.09, vol: 0.16, freq: 2600, q: 2 });
    this.tone({ freq: 1400, freq2: 200, type: 'sawtooth', dur: 0.08, vol: 0.06 });
  }

  hit() {
    this.noise({ dur: 0.05, vol: 0.10, freq: 1800, q: 1 });
  }

  explode(big = false) {
    this.noise({ dur: big ? 0.7 : 0.3, vol: big ? 0.55 : 0.28, freq: big ? 300 : 500, q: 0.5 });
    this.tone({ freq: big ? 160 : 220, freq2: 40, type: 'sine', dur: big ? 0.6 : 0.3, vol: big ? 0.5 : 0.3 });
  }

  hurt() {
    this.tone({ freq: 200, freq2: 60, type: 'sawtooth', dur: 0.22, vol: 0.32 });
    this.noise({ dur: 0.18, vol: 0.2, freq: 700, q: 0.7 });
  }

  pickup() {
    this.tone({ freq: 660, freq2: 990, type: 'sine', dur: 0.07, vol: 0.10 });
  }

  core() {
    this.tone({ freq: 523, type: 'sine', dur: 0.1, vol: 0.16 });
    this.tone({ freq: 784, type: 'sine', dur: 0.12, vol: 0.16, delay: 0.07 });
    this.tone({ freq: 1046, type: 'sine', dur: 0.18, vol: 0.16, delay: 0.14 });
  }

  levelup() {
    const seq = [523, 659, 784, 1046];
    seq.forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.22, vol: 0.22, delay: i * 0.08 }));
  }

  uiClick() {
    this.tone({ freq: 1200, freq2: 800, type: 'sine', dur: 0.05, vol: 0.12 });
  }

  bossRoar() {
    this.tone({ freq: 90, freq2: 45, type: 'sawtooth', dur: 1.1, vol: 0.5 });
    this.tone({ freq: 136, freq2: 60, type: 'square', dur: 0.9, vol: 0.25, delay: 0.1 });
    this.noise({ dur: 1.0, vol: 0.25, freq: 240, q: 0.6 });
  }

  victory() {
    const seq = [392, 523, 659, 784, 1046, 1318];
    seq.forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.35, vol: 0.22, delay: i * 0.13 }));
  }

  gameover() {
    const seq = [392, 330, 262, 196];
    seq.forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.4, vol: 0.22, delay: i * 0.18 }));
  }

  // ---- procedural music -------------------------------------------------
  // 4 bars of Am - F - C - G at 100 BPM. Bass on eighths, pad at bar start,
  // pentatonic arp on sixteenths, noise hats on offbeats.
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this._step = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.06;
    this._timer = setInterval(() => this._schedule(), 90);
  }

  stopMusic() {
    this.musicOn = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _schedule() {
    if (!this.ctx || !this.musicOn) return;
    const spb = 60 / 100 / 4; // seconds per 16th note
    while (this._nextNoteTime < this.ctx.currentTime + 0.28) {
      this._playStep(this._step, this._nextNoteTime);
      this._nextNoteTime += spb;
      this._step = (this._step + 1) % 64;
    }
  }

  _playStep(step, t) {
    const delay = Math.max(0, t - this.ctx.currentTime);
    const bar = Math.floor(step / 16);
    const roots = [45, 41, 48, 43]; // A2 F2 C3 G2 (midi)
    const chords = [
      [57, 60, 64],
      [53, 57, 60],
      [55, 60, 64],
      [55, 59, 62],
    ];
    const root = roots[bar];
    const s16 = step % 16;
    // Bass: driving eighths, root with octave hops.
    if (s16 % 2 === 0) {
      const oct = s16 % 8 === 6 ? 12 : 0;
      this.tone({ freq: midi(root - 12 + oct), type: 'triangle', dur: 0.22, vol: 0.5, bus: this.musicBus, delay });
    }
    // Pad: whole-bar chord.
    if (s16 === 0) {
      chords[bar].forEach((m) =>
        this.tone({ freq: midi(m), type: 'sine', dur: 2.3, vol: 0.10, bus: this.musicBus, delay })
      );
    }
    // Arp: A-minor pentatonic walk on 16ths, sparse.
    const penta = [57, 60, 62, 64, 67, 69, 72];
    if (s16 % 2 === 1 && (step * 7) % 5 !== 0) {
      const idx = Math.abs(((step * 3 + bar * 2) % penta.length));
      this.tone({ freq: midi(penta[idx]), type: 'sine', dur: 0.12, vol: 0.075, bus: this.musicBus, delay });
    }
    // Hat: offbeat ticks.
    if (s16 % 4 === 2) {
      if (!this.muted) {
        const t0 = t;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const f = this.ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 7000;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.05, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
        src.connect(f);
        f.connect(g);
        g.connect(this.musicBus);
        src.start(t0);
        src.stop(t0 + 0.06);
      }
    }
  }
}
