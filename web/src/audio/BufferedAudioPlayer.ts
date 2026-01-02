export class BufferedAudioPlayer {
  private static readonly FADE_S = 0.01;
  private context: AudioContext;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private sourceGain: GainNode | null = null;
  private masterGain: GainNode;
  private baseGain = 0.9;
  private startAt = 0;
  private offset = 0;
  private playing = false;
  private onEnded: (() => void) | null = null;

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.baseGain;
    this.masterGain.connect(this.context.destination);
  }

  async loadBuffer(buffer: AudioBuffer) {
    this.stop();
    this.buffer = buffer;
    this.offset = 0;
  }

  async decode(arrayBuffer: ArrayBuffer) {
    const buffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
    await this.loadBuffer(buffer);
  }

  play() {
    if (!this.buffer || this.playing) {
      return;
    }
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    const now = this.context.currentTime;
    this.startSourceAt(this.offset, now, true);
  }

  pause() {
    if (!this.playing) {
      return;
    }
    this.offset = this.getCurrentTime();
    this.stopSource();
    this.playing = false;
  }

  stop() {
    this.stopSource();
    this.playing = false;
    this.offset = 0;
  }

  seek(time: number) {
    if (!this.buffer) {
      return;
    }
    const clamped = Math.max(0, Math.min(this.buffer.duration, time));
    this.offset = clamped;
    if (this.playing) {
      const now = this.context.currentTime;
      this.fadeOutCurrentSource(now);
      this.startSourceAt(this.offset, now, true);
    }
  }

  getCurrentTime(): number {
    if (!this.buffer) {
      return 0;
    }
    if (!this.playing) {
      return this.offset;
    }
    const time = this.context.currentTime - this.startAt;
    return Math.max(0, Math.min(this.buffer.duration, time));
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setOnEnded(handler: (() => void) | null) {
    this.onEnded = handler;
  }

  getDuration(): number | null {
    return this.buffer ? this.buffer.duration : null;
  }

  private stopSource() {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop(0);
      } catch {
        // no-op
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.sourceGain) {
      this.sourceGain.disconnect();
      this.sourceGain = null;
    }
  }

  private fadeOutCurrentSource(startTime: number) {
    if (!this.source || !this.sourceGain) {
      return;
    }
    const source = this.source;
    const gain = this.sourceGain;
    const fadeEnd = startTime + BufferedAudioPlayer.FADE_S;
    gain.gain.cancelScheduledValues(startTime);
    gain.gain.setValueAtTime(gain.gain.value, startTime);
    gain.gain.linearRampToValueAtTime(0, fadeEnd);
    source.onended = null;
    try {
      source.stop(fadeEnd);
    } catch {
      // no-op
    }
    window.setTimeout(() => {
      if (this.source === source) {
        source.disconnect();
        this.source = null;
      }
      if (this.sourceGain === gain) {
        gain.disconnect();
        this.sourceGain = null;
      }
    }, BufferedAudioPlayer.FADE_S * 1000 + 10);
  }

  private startSourceAt(offset: number, startTime: number, fadeIn: boolean) {
    if (!this.buffer) {
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(fadeIn ? 0 : 1, startTime);
    if (fadeIn) {
      gain.gain.linearRampToValueAtTime(1, startTime + BufferedAudioPlayer.FADE_S);
    }
    source.connect(gain);
    gain.connect(this.masterGain);
    this.source = source;
    this.sourceGain = gain;
    this.startAt = startTime - offset;
    this.playing = true;
    source.onended = () => {
      if (this.source !== source) {
        return;
      }
      if (this.playing) {
        this.playing = false;
        this.offset = this.buffer ? this.buffer.duration : 0;
        this.onEnded?.();
      }
    };
    const duration = this.buffer.duration - offset;
    source.start(startTime, offset, Math.max(0, duration));
  }
}
