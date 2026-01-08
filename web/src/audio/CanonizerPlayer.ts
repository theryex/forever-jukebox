/**
 * Canonizer Audio Player
 * 
 * Handles dual-stream audio playback for the autocanonizer.
 * Plays two copies of the audio: the main track and an offset track.
 * 
 * Ported from the Eternal Jukebox's canonizer_jremix.js getPlayer()
 */

import type { CanonizerBeat } from "../engine/CanonizerEngine";

export interface CanonizerPlayerConfig {
    /** Master gain balance between main and other track (0-1, default 0.53) */
    masterGain: number;
    /** Maximum skew delta before resync (default 0.05 seconds) */
    maxSkewDelta: number;
}

const DEFAULT_CONFIG: CanonizerPlayerConfig = {
    masterGain: 0.53,
    maxSkewDelta: 0.05,
};

export class CanonizerPlayer {
    private context: AudioContext | null = null;
    private buffer: AudioBuffer | null = null;
    private config: CanonizerPlayerConfig;

    private mainGain: GainNode | null = null;
    private otherGain: GainNode | null = null;

    private mainSource: AudioBufferSourceNode | null = null;
    private otherSource: AudioBufferSourceNode | null = null;

    private currentBeat: CanonizerBeat | null = null;
    private deltaTime: number = 0;
    private skewDelta: number = 0;
    private duration: number = 0;

    private isPlaying: boolean = false;

    constructor(config?: Partial<CanonizerPlayerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize the audio context and load the audio buffer.
     */
    async initialize(audioUrl: string): Promise<void> {
        // Create or resume audio context
        if (!this.context) {
            this.context = new AudioContext();
        }
        if (this.context.state === "suspended") {
            await this.context.resume();
        }

        // Create gain nodes
        this.mainGain = this.context.createGain();
        this.otherGain = this.context.createGain();

        this.mainGain.connect(this.context.destination);
        this.otherGain.connect(this.context.destination);

        this.mainGain.gain.value = this.config.masterGain;
        this.otherGain.gain.value = 1 - this.config.masterGain;

        // Fetch and decode audio
        const response = await fetch(audioUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        this.buffer = await this.context.decodeAudioData(arrayBuffer);
        this.duration = this.buffer.duration;
    }

    /**
     * Load audio from an ArrayBuffer (for file uploads).
     */
    async loadFromBuffer(arrayBuffer: ArrayBuffer): Promise<void> {
        if (!this.context) {
            this.context = new AudioContext();
        }
        if (this.context.state === "suspended") {
            await this.context.resume();
        }

        // Create gain nodes if needed
        if (!this.mainGain) {
            this.mainGain = this.context.createGain();
            this.mainGain.connect(this.context.destination);
            this.mainGain.gain.value = this.config.masterGain;
        }
        if (!this.otherGain) {
            this.otherGain = this.context.createGain();
            this.otherGain.connect(this.context.destination);
            this.otherGain.gain.value = 1 - this.config.masterGain;
        }

        this.buffer = await this.context.decodeAudioData(arrayBuffer);
        this.duration = this.buffer.duration;
    }

    /**
     * Get the audio buffer duration.
     */
    getDuration(): number {
        return this.duration;
    }

    /**
     * Check if player is ready.
     */
    isReady(): boolean {
        return this.buffer !== null && this.context !== null;
    }

    /**
     * Play a beat with its offset counterpart.
     * Returns the duration until the next beat should be played.
     */
    playBeat(beat: CanonizerBeat): number {
        if (!this.context || !this.buffer || !this.mainGain || !this.otherGain) {
            return 0;
        }

        // Handle main track
        // For click reduction, we continuously play as much as we can
        const needsMainRestart = this.currentBeat === null ||
            (this.currentBeat as any).next !== beat;

        if (needsMainRestart) {
            this.stopMainSource();
            const remainingDuration = this.duration - beat.start;
            this.mainSource = this.llPlay(this.buffer, beat.start, remainingDuration, this.mainGain);
            this.deltaTime = this.context.currentTime - beat.start;
        }

        const now = this.context.currentTime - this.deltaTime;
        const delta = now - beat.start;

        // Handle offset track
        this.otherGain.gain.value = (1 - this.config.masterGain) * beat.otherGain;

        const prevOther = (this.currentBeat as any)?.other as CanonizerBeat | undefined;
        const needsOtherRestart = this.currentBeat === null ||
            (prevOther && (prevOther as any).next !== beat.other) ||
            Math.abs(this.skewDelta) > this.config.maxSkewDelta;

        if (needsOtherRestart) {
            this.skewDelta = 0;
            this.stopOtherSource();
            const otherRemainingDuration = this.duration - beat.other.start;
            this.otherSource = this.llPlay(this.buffer, beat.other.start, otherRemainingDuration, this.otherGain);
        }

        // Track skew between main and offset
        this.skewDelta += beat.duration - beat.other.duration;

        this.currentBeat = beat;
        this.isPlaying = true;

        return beat.duration - delta;
    }

    /**
     * Low-level play function - creates a buffer source and starts it.
     */
    private llPlay(
        buffer: AudioBuffer,
        start: number,
        duration: number,
        gainNode: GainNode
    ): AudioBufferSourceNode {
        const source = this.context!.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNode);
        source.start(0, start, duration);
        return source;
    }

    private stopMainSource(): void {
        if (this.mainSource) {
            try {
                this.mainSource.stop();
            } catch {
                // Ignore errors from already stopped sources
            }
            this.mainSource = null;
        }
    }

    private stopOtherSource(): void {
        if (this.otherSource) {
            try {
                this.otherSource.stop();
            } catch {
                // Ignore errors from already stopped sources
            }
            this.otherSource = null;
        }
    }

    /**
     * Stop playback completely.
     */
    stop(): void {
        this.stopMainSource();
        this.stopOtherSource();
        this.currentBeat = null;
        this.skewDelta = 0;
        this.isPlaying = false;
    }

    /**
     * Get the current audio context time.
     */
    getCurrentTime(): number {
        return this.context?.currentTime || 0;
    }

    /**
     * Check if currently playing.
     */
    getIsPlaying(): boolean {
        return this.isPlaying;
    }

    /**
     * Set the master gain balance.
     */
    setMasterGain(value: number): void {
        this.config.masterGain = Math.max(0, Math.min(1, value));
        if (this.mainGain) {
            this.mainGain.gain.value = this.config.masterGain;
        }
        if (this.otherGain) {
            this.otherGain.gain.value = 1 - this.config.masterGain;
        }
    }

    /**
     * Get the current master gain.
     */
    getMasterGain(): number {
        return this.config.masterGain;
    }

    /**
     * Clean up resources.
     */
    dispose(): void {
        this.stop();
        if (this.mainGain) {
            this.mainGain.disconnect();
            this.mainGain = null;
        }
        if (this.otherGain) {
            this.otherGain.disconnect();
            this.otherGain = null;
        }
        if (this.context) {
            this.context.close().catch(() => { });
            this.context = null;
        }
        this.buffer = null;
    }
}
