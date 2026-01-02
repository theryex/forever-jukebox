export class BufferedAudioPlayer {
  private static readonly SEEK_EARLY_S = 0.005;
  private context: AudioContext;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private baseGain = 0.9;
  private startAt = 0;
  private offset = 0;
  private playing = false;
  private onEnded: (() => void) | null = null;

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext();
    this.gain = this.context.createGain();
    this.gain.gain.value = this.baseGain;
    this.gain.connect(this.context.destination);
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
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.baseGain, now);
    this.startSourceAt(this.offset, now);
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
      // Start slightly in the past to counter scheduling jitter at beat jumps.
      const startAt = now - BufferedAudioPlayer.SEEK_EARLY_S;
      const currentSource = this.source;
      if (currentSource) {
        currentSource.onended = null;
        try {
          currentSource.stop(startAt);
        } catch {
          // no-op
        }
        window.setTimeout(() => {
          if (this.source === currentSource) {
            currentSource.disconnect();
            this.source = null;
          }
        }, 15);
      }
      this.startSourceAt(this.offset, startAt);
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
  }

  private startSourceAt(offset: number, startTime: number) {
    if (!this.buffer) {
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gain);
    this.source = source;
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
