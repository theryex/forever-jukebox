export class BufferedAudioPlayer {
  private context: AudioContext;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private pendingSource: AudioBufferSourceNode | null = null;
  private pendingSwapTimer: number | null = null;
  private pendingStartAt = 0;
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
      this.stopSource();
      this.startSourceAt(this.offset, now);
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

  scheduleJump(targetTime: number, transitionTime: number) {
    if (!this.buffer || !this.playing) {
      return;
    }
    const currentTrackTime = this.getCurrentTime();
    const delta = Math.max(0, transitionTime - currentTrackTime);
    const audioStart = this.context.currentTime + delta;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.masterGain);
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
    const duration = this.buffer.duration - targetTime;
    source.start(audioStart, targetTime, Math.max(0, duration));
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop(audioStart);
      } catch {
        // no-op
      }
    }
    this.clearPendingSwap();
    this.pendingSource = source;
    this.pendingStartAt = audioStart - targetTime;
    const delayMs = Math.max(0, (audioStart - this.context.currentTime) * 1000);
    this.pendingSwapTimer = window.setTimeout(() => {
      if (this.pendingSource !== source) {
        return;
      }
      if (this.source) {
        this.source.disconnect();
      }
      this.source = source;
      this.startAt = this.pendingStartAt;
      this.pendingSource = null;
      this.pendingSwapTimer = null;
    }, delayMs);
  }

  private stopSource() {
    this.clearPendingSwap();
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
    if (this.pendingSource) {
      this.pendingSource.onended = null;
      try {
        this.pendingSource.stop(0);
      } catch {
        // no-op
      }
      this.pendingSource.disconnect();
      this.pendingSource = null;
    }
  }

  private clearPendingSwap() {
    if (this.pendingSwapTimer !== null) {
      window.clearTimeout(this.pendingSwapTimer);
      this.pendingSwapTimer = null;
    }
  }

  private startSourceAt(offset: number, startTime: number) {
    if (!this.buffer) {
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.masterGain);
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
