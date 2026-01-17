/**
 * Canonizer Engine
 * 
 * Creates a musical canon by playing the song against a time-offset copy of itself.
 * The offset is determined per-section based on beat similarity analysis.
 * 
 * Ported from the Eternal Jukebox's canonizer_jremix.js
 */

import type { AnalysisResult, Beat, Section, Segment } from "./types";

export interface CanonizerBeat extends Beat {
    /** Section index this beat belongs to */
    section: number;
    /** The most similar beat (for similarity calculation) */
    sim: CanonizerBeat | null;
    /** Distance to the most similar beat */
    simDistance: number;
    /** The offset beat to play alongside this one */
    other: CanonizerBeat;
    /** Gain for the offset track (0-1, reduced at transitions) */
    otherGain: number;
    /** Overlapping segments for similarity calculation */
    overlappingSegments: Segment[];
    /** Index within parent bar */
    indexInParent: number;
}

export interface CanonizerConfig {
    /** Weight for timbre in similarity calculation */
    timbreWeight: number;
    /** Weight for pitch in similarity calculation */
    pitchWeight: number;
    /** Weight for loudness start in similarity calculation */
    loudStartWeight: number;
    /** Weight for loudness max in similarity calculation */
    loudMaxWeight: number;
    /** Weight for duration in similarity calculation */
    durationWeight: number;
    /** Weight for confidence in similarity calculation */
    confidenceWeight: number;
}

const DEFAULT_CONFIG: CanonizerConfig = {
    timbreWeight: 1,
    pitchWeight: 10,
    loudStartWeight: 1,
    loudMaxWeight: 1,
    durationWeight: 100,
    confidenceWeight: 1,
};

export class CanonizerEngine {
    private config: CanonizerConfig;
    private beats: CanonizerBeat[] = [];
    private sections: Section[] = [];
    private duration: number = 0;
    private ready: boolean = false;

    constructor(config?: Partial<CanonizerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Process analysis data and prepare for canonized playback.
     */
    loadAnalysis(analysis: AnalysisResult): void {
        this.sections = analysis.sections || [];
        this.duration = analysis.track?.duration || 0;

        // Convert beats to canonizer beats
        this.beats = (analysis.beats || []).map((beat, index) => ({
            ...beat,
            which: index,
            section: 0,
            sim: null,
            simDistance: Infinity,
            other: null as unknown as CanonizerBeat, // Will be set later
            otherGain: 1,
            overlappingSegments: [],
            indexInParent: 0,
        }));

        // Connect quanta (prev/next links)
        this.connectBeats();

        // Connect overlapping segments
        this.connectOverlappingSegments(analysis.segments || []);

        // Calculate bar index for each beat
        this.connectBars(analysis.bars || []);

        // Assign section indices
        this.assignSections();

        // Calculate nearest neighbors
        this.calculateNearestNeighbors();

        // Fold by section to determine offsets
        this.foldBySection();

        this.ready = true;
    }

    /**
     * Get the prepared canonizer beats for playback.
     */
    getBeats(): CanonizerBeat[] {
        return this.beats;
    }

    /**
     * Check if the engine is ready for playback.
     */
    isReady(): boolean {
        return this.ready;
    }

    /**
     * Get the total duration.
     */
    getDuration(): number {
        return this.duration;
    }

    /**
     * Get the sections for visualization.
     */
    getSections(): Section[] {
        return this.sections;
    }

    private connectBeats(): void {
        for (let i = 0; i < this.beats.length; i++) {
            const beat = this.beats[i];
            beat.which = i;
            if (i > 0) {
                (beat as any).prev = this.beats[i - 1];
            }
            if (i < this.beats.length - 1) {
                (beat as any).next = this.beats[i + 1];
            }
        }

        // Make last beat extend to end of track
        if (this.beats.length > 0 && this.duration > 0) {
            const lastBeat = this.beats[this.beats.length - 1];
            lastBeat.duration = this.duration - lastBeat.start;
        }
    }

    private connectOverlappingSegments(segments: Segment[]): void {
        let lastSegIdx = 0;

        for (const beat of this.beats) {
            beat.overlappingSegments = [];

            for (let j = lastSegIdx; j < segments.length; j++) {
                const seg = segments[j];

                // Segment ends before beat starts
                if (seg.start + seg.duration < beat.start) {
                    continue;
                }

                // Segment starts after beat ends
                if (seg.start > beat.start + beat.duration) {
                    break;
                }

                lastSegIdx = j;
                beat.overlappingSegments.push(seg);
            }
        }
    }

    private connectBars(bars: { start: number; duration: number }[]): void {
        let lastBeatIdx = 0;

        for (const bar of bars) {
            let indexInBar = 0;

            for (let j = lastBeatIdx; j < this.beats.length; j++) {
                const beat = this.beats[j];

                if (beat.start >= bar.start && beat.start < bar.start + bar.duration) {
                    beat.indexInParent = indexInBar++;
                    lastBeatIdx = j;
                } else if (beat.start >= bar.start + bar.duration) {
                    break;
                }
            }
        }
    }

    private assignSections(): void {
        for (const beat of this.beats) {
            beat.section = this.getSectionIndex(beat.start);
        }
    }

    private getSectionIndex(time: number): number {
        for (let i = this.sections.length - 1; i >= 0; i--) {
            if (time >= this.sections[i].start) {
                return i;
            }
        }
        return 0;
    }

    private calculateNearestNeighbors(): void {
        for (const beat of this.beats) {
            this.calculateNearestNeighborForBeat(beat);
        }
    }

    private calculateNearestNeighborForBeat(beat: CanonizerBeat): void {
        let simBeat: CanonizerBeat | null = null;
        let simDistance = Infinity;

        for (const other of this.beats) {
            if (beat === other) continue;

            let sum = 0;
            for (let j = 0; j < beat.overlappingSegments.length; j++) {
                const seg1 = beat.overlappingSegments[j];
                let distance = 100;

                if (j < other.overlappingSegments.length) {
                    const seg2 = other.overlappingSegments[j];
                    distance = this.getSegmentDistance(seg1, seg2);
                }
                sum += distance;
            }

            // Penalize beats at different position within their bar
            const positionPenalty = beat.indexInParent === other.indexInParent ? 0 : 100;
            const totalDistance = (beat.overlappingSegments.length > 0
                ? sum / beat.overlappingSegments.length
                : sum) + positionPenalty;

            if (totalDistance < simDistance && totalDistance > 0) {
                simDistance = totalDistance;
                simBeat = other;
            }
        }

        beat.sim = simBeat;
        beat.simDistance = simDistance;
    }

    private getSegmentDistance(seg1: Segment, seg2: Segment): number {
        const timbre = this.euclideanDistance(seg1.timbre || [], seg2.timbre || []);
        const pitch = this.euclideanDistance(seg1.pitches || [], seg2.pitches || []);
        const loudStart = Math.abs((seg1.loudness_start || 0) - (seg2.loudness_start || 0));
        const loudMax = Math.abs((seg1.loudness_max || 0) - (seg2.loudness_max || 0));
        const duration = Math.abs(seg1.duration - seg2.duration);
        const confidence = Math.abs((seg1.confidence || 0) - (seg2.confidence || 0));

        return (
            timbre * this.config.timbreWeight +
            pitch * this.config.pitchWeight +
            loudStart * this.config.loudStartWeight +
            loudMax * this.config.loudMaxWeight +
            duration * this.config.durationWeight +
            confidence * this.config.confidenceWeight
        );
    }

    private euclideanDistance(v1: number[], v2: number[]): number {
        let sum = 0;
        const len = Math.min(v1.length, v2.length);
        for (let i = 0; i < len; i++) {
            const delta = (v2[i] || 0) - (v1[i] || 0);
            sum += delta * delta;
        }
        return Math.sqrt(sum);
    }

    private foldBySection(): void {
        const nSections = this.sections.length;

        // For each section, find the most common offset delta
        for (let section = 0; section < nSections; section++) {
            const counter: Record<number, number> = {};

            for (const beat of this.beats) {
                if (beat.section === section && beat.sim) {
                    const delta = beat.which - beat.sim.which;
                    counter[delta] = (counter[delta] || 0) + 1;
                }
            }

            // Find the most common delta
            let bestDelta = 0;
            let maxCount = 0;
            for (const [delta, count] of Object.entries(counter)) {
                if (count > maxCount) {
                    maxCount = count;
                    bestDelta = parseInt(delta, 10);
                }
            }

            // Assign the offset beat for each beat in this section
            for (const beat of this.beats) {
                if (beat.section === section) {
                    const otherIdx = beat.which - bestDelta;
                    if (otherIdx >= 0 && otherIdx < this.beats.length) {
                        beat.other = this.beats[otherIdx];
                    } else {
                        beat.other = beat; // Self if out of bounds
                    }
                    beat.otherGain = 1;
                }
            }
        }

        // Reduce gain at discontinuities
        for (const beat of this.beats) {
            const prev = (beat as any).prev as CanonizerBeat | undefined;
            const next = (beat as any).next as CanonizerBeat | undefined;

            if (prev?.other && prev.other.which + 1 !== beat.other.which) {
                prev.otherGain = 0.5;
                beat.otherGain = 0.5;
            }

            if (next?.other && next.other.which - 1 !== beat.other.which) {
                next.otherGain = 0.5;
                beat.otherGain = 0.5;
            }
        }
    }
}
