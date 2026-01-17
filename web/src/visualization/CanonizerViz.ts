/**
 * Canonizer Visualization
 *
 * A linear timeline visualization for the Autocanonizer that displays:
 * - Beat bars arranged horizontally with width proportional to duration
 * - Bar heights based on beat volume/loudness
 * - Colors based on segment timbre values
 * - Section markers along the bottom
 * - Connection curves showing offset track discontinuities
 * - Two cursors: main track (blue) and offset track (green)
 *
 * Ported from the original EternalJukebox canonizer visualization.
 */

import type { CanonizerBeat } from "../engine/CanonizerEngine";

interface CanonizerVisualizationData {
    beats: CanonizerBeat[];
    duration: number;
    /** Optional: sections for section markers */
    sections?: Array<{ start: number; duration: number }>;
    /** Optional: segments for timbre-based coloring */
    segments?: Array<{
        start: number;
        duration: number;
        timbre?: number[];
        loudness_max?: number;
    }>;
}

interface BeatTile {
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    beat: CanonizerBeat;
}

interface ConnectionPath {
    x1: number;
    y1: number;
    cx: number;
    cy: number;
    x2: number;
    y2: number;
    color: string;
}

export class CanonizerViz {
    private container: HTMLElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    private data: CanonizerVisualizationData | null = null;
    private tiles: BeatTile[] = [];
    private connections: ConnectionPath[] = [];

    private currentMainIndex = -1;
    private currentOtherIndex = -1;

    private visible = true;

    // Padding and layout
    private readonly hPad = 20;
    private readonly vPad = 20;
    private readonly sectionHeight = 20;
    private readonly connectionAreaHeight = 100;
    private readonly cursorWidth = 8;

    // Timbre normalization bounds
    private cmin = [100, 100, 100];
    private cmax = [-100, -100, -100];

    // Volume normalization
    private minVolume = 0;
    private maxVolume = -60;

    // Theme colors
    private theme = {
        masterColor: "#4F8FFF",
        otherColor: "#10DF00",
        background: "transparent",
        sectionColors: [
            "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c",
            "#3498db", "#9b59b6", "#34495e", "#e91e63", "#00bcd4"
        ],
    };

    constructor(container: HTMLElement) {
        this.container = container;
        this.canvas = document.createElement("canvas");
        const ctx = this.canvas.getContext("2d");
        if (!ctx) {
            throw new Error("Canvas not supported");
        }
        this.ctx = ctx;
        this.container.appendChild(this.canvas);
        this.applyCanvasStyles();
        this.updateTheme();
        this.resize();
    }

    setVisible(visible: boolean) {
        this.visible = visible;
        this.canvas.style.display = visible ? "block" : "none";
        if (visible && this.data) {
            this.resize();
            this.draw();
        }
    }

    setData(data: CanonizerVisualizationData) {
        this.data = data;
        this.normalizeColors();
        this.normalizeVolumes();
        this.computeTiles();
        this.computeConnections();
        this.draw();
    }

    /**
     * Update the visualization with current playback positions.
     * @param mainIndex - Index of the main track beat
     * @param otherIndex - Index of the offset track beat
     */
    update(mainIndex: number, otherIndex: number) {
        this.currentMainIndex = mainIndex;
        this.currentOtherIndex = otherIndex;
        this.draw();
    }

    reset() {
        this.currentMainIndex = -1;
        this.currentOtherIndex = -1;
        this.draw();
    }

    refresh() {
        if (!this.data) {
            return;
        }
        this.updateTheme();
        this.computeTiles();
        this.computeConnections();
        this.draw();
    }

    resizeNow() {
        this.resize();
    }

    private applyCanvasStyles() {
        this.canvas.style.position = "absolute";
        this.canvas.style.inset = "0";
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.style.zIndex = "100";
        this.canvas.style.pointerEvents = "none";
    }

    private resize() {
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (this.data) {
            this.computeTiles();
            this.computeConnections();
            this.draw();
        }
    }

    private normalizeColors() {
        if (!this.data?.segments || this.data.segments.length === 0) {
            // Reset to wide bounds if no segments
            this.cmin = [100, 100, 100];
            this.cmax = [-100, -100, -100];
            return;
        }

        // Reset bounds
        this.cmin = [100, 100, 100];
        this.cmax = [-100, -100, -100];

        // Find min/max for first 3 timbre values
        for (const seg of this.data.segments) {
            if (!seg.timbre) continue;
            for (let j = 0; j < 3; j++) {
                const t = seg.timbre[j] ?? 0;
                if (t < this.cmin[j]) this.cmin[j] = t;
                if (t > this.cmax[j]) this.cmax[j] = t;
            }
        }
    }

    private normalizeVolumes() {
        if (!this.data) return;

        this.minVolume = 0;
        this.maxVolume = -60;

        // Calculate average loudness for each beat from overlapping segments
        for (const beat of this.data.beats) {
            const vol = this.getAverageVolume(beat);
            if (vol > this.maxVolume) this.maxVolume = vol;
            if (vol < this.minVolume) this.minVolume = vol;
        }
    }

    private getAverageVolume(beat: CanonizerBeat): number {
        if (beat.overlappingSegments && beat.overlappingSegments.length > 0) {
            let sum = 0;
            for (const seg of beat.overlappingSegments) {
                sum += seg.loudness_max ?? -30;
            }
            return sum / beat.overlappingSegments.length;
        }
        return -30; // Default if no segments
    }

    private getNormalizedVolume(beat: CanonizerBeat): number {
        const vol = this.getAverageVolume(beat);
        if (this.maxVolume === this.minVolume) {
            return 0.5;
        }
        return (vol - this.minVolume) / (this.maxVolume - this.minVolume);
    }

    private getTimbreColor(beat: CanonizerBeat): string {
        // Get the first overlapping segment for color
        if (!beat.overlappingSegments || beat.overlappingSegments.length === 0) {
            return "#666666";
        }

        const seg = beat.overlappingSegments[0];
        if (!seg.timbre || seg.timbre.length < 3) {
            return "#666666";
        }

        const results: number[] = [];
        for (let i = 0; i < 3; i++) {
            const t = seg.timbre[i] ?? 0;
            const range = this.cmax[i] - this.cmin[i];
            const norm = range !== 0 ? (t - this.cmin[i]) / range : 0.5;
            results[i] = Math.floor(norm * 255);
        }

        // Original uses BGR order for aesthetic effect
        return this.toRgb(results[2], results[1], results[0]);
    }

    private toRgb(r: number, g: number, b: number): string {
        const toHex = (v: number) => {
            const clamped = Math.max(0, Math.min(255, Math.floor(v)));
            const hex = clamped.toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        };
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    private computeTiles() {
        if (!this.data) {
            this.tiles = [];
            return;
        }

        const { width, height } = this.container.getBoundingClientRect();
        const beatAreaHeight = height - this.vPad - this.sectionHeight - this.connectionAreaHeight;
        const trackWidth = width - this.hPad * 2;

        this.tiles = [];

        for (let i = 0; i < this.data.beats.length; i++) {
            const beat = this.data.beats[i];
            const tileWidth = trackWidth * beat.duration / this.data.duration;
            const x = this.hPad + trackWidth * beat.start / this.data.duration;

            // Height based on normalized volume (with 4th power for more dynamic range)
            const normalizedVol = this.getNormalizedVolume(beat);
            const tileHeight = beatAreaHeight * Math.pow(normalizedVol, 4);

            this.tiles.push({
                x,
                y: beatAreaHeight - tileHeight,
                width: tileWidth,
                height: tileHeight,
                color: this.getTimbreColor(beat),
                beat,
            });
        }
    }

    private computeConnections() {
        if (!this.data) {
            this.connections = [];
            return;
        }

        const { width, height } = this.container.getBoundingClientRect();
        const beatAreaHeight = height - this.vPad - this.sectionHeight - this.connectionAreaHeight;
        const trackWidth = width - this.hPad * 2;

        this.connections = [];

        // Find max delta for normalizing connection heights
        let maxDelta = 0;
        for (let i = 0; i < this.data.beats.length - 1; i++) {
            const beat = this.data.beats[i];
            const nextBeat = this.data.beats[i + 1];
            if (beat.other && nextBeat.other) {
                const delta = Math.abs(beat.other.which - nextBeat.other.which);
                if (delta > maxDelta) maxDelta = delta;
            }
        }

        if (maxDelta === 0) return;

        // Create connections for discontinuities
        for (let i = 0; i < this.data.beats.length - 1; i++) {
            const beat = this.data.beats[i];
            const nextBeat = this.data.beats[i + 1];

            if (!beat.other || !nextBeat.other) continue;

            const delta = nextBeat.other.which - beat.other.which;
            if (i !== 0 && delta !== 1) {
                // There's a discontinuity, draw a connection curve
                const absDelta = Math.abs(delta);
                let cy = (absDelta / maxDelta) * this.connectionAreaHeight * 2;
                if (cy < 30) cy = 30;

                // Curve goes below the beat area
                const curveY = beatAreaHeight + cy;

                // x positions based on the 'other' beats
                const x1 = this.hPad + trackWidth * beat.other.start / this.data.duration;
                const x2 = this.hPad + trackWidth * nextBeat.other.start / this.data.duration;
                const cx = (x1 + x2) / 2;

                this.connections.push({
                    x1,
                    y1: beatAreaHeight,
                    cx,
                    cy: curveY,
                    x2,
                    y2: beatAreaHeight,
                    color: this.getTimbreColor(beat.other as CanonizerBeat),
                });
            }
        }
    }

    private updateTheme() {
        const styles = getComputedStyle(document.documentElement);
        // Use retro colors if in retro mode
        const beatHighlight = styles.getPropertyValue("--beat-highlight").trim();
        if (beatHighlight) {
            this.theme.masterColor = beatHighlight;
        }
        const edgeBright = styles.getPropertyValue("--edge-stroke-bright").trim();
        if (edgeBright) {
            this.theme.otherColor = edgeBright;
        }
    }

    private draw() {
        const { width, height } = this.container.getBoundingClientRect();
        this.ctx.clearRect(0, 0, width, height);
        if (!this.data || !this.visible) {
            return;
        }

        const beatAreaHeight = height - this.vPad - this.sectionHeight - this.connectionAreaHeight;

        this.ctx.save();

        // Draw beat tiles
        for (const tile of this.tiles) {
            this.ctx.fillStyle = tile.color;
            this.ctx.strokeStyle = tile.color;
            this.ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
        }

        // Draw connection curves
        this.ctx.lineWidth = 3;
        for (const conn of this.connections) {
            this.ctx.strokeStyle = conn.color;
            this.ctx.beginPath();
            this.ctx.moveTo(conn.x1, conn.y1);
            this.ctx.quadraticCurveTo(conn.cx, conn.cy, conn.x2, conn.y2);
            this.ctx.stroke();
        }

        // Draw section markers
        this.drawSections(beatAreaHeight);

        // Draw cursor guidelines
        this.drawCursorGuideline(beatAreaHeight);

        // Draw cursors
        this.drawCursors(beatAreaHeight);

        this.ctx.restore();
    }

    private drawSections(beatAreaHeight: number) {
        if (!this.data?.sections || this.data.sections.length === 0) {
            return;
        }

        const { width } = this.container.getBoundingClientRect();
        const trackWidth = width - this.hPad * 2;
        const sectionY = beatAreaHeight;

        for (let i = 0; i < this.data.sections.length; i++) {
            const section = this.data.sections[i];
            const sectionWidth = trackWidth * section.duration / this.data.duration;
            const x = this.hPad + trackWidth * section.start / this.data.duration;
            const color = this.theme.sectionColors[i % this.theme.sectionColors.length];

            this.ctx.fillStyle = color;
            this.ctx.fillRect(x, sectionY, sectionWidth, this.sectionHeight);
        }
    }

    private drawCursorGuideline(beatAreaHeight: number) {
        // Draw thin horizontal line where cursors travel
        const guidelineY = beatAreaHeight - this.vPad / 2;
        const { width } = this.container.getBoundingClientRect();

        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(this.hPad, guidelineY);
        this.ctx.lineTo(width - this.hPad, guidelineY);
        this.ctx.stroke();
    }

    private drawCursors(beatAreaHeight: number) {
        if (!this.data) return;

        const { width } = this.container.getBoundingClientRect();
        const trackWidth = width - this.hPad * 2;
        const cursorHeight = this.vPad / 2;

        // Main cursor
        if (this.currentMainIndex >= 0 && this.currentMainIndex < this.data.beats.length) {
            const beat = this.data.beats[this.currentMainIndex];
            const x = this.hPad + trackWidth * beat.start / this.data.duration - this.cursorWidth / 2;
            const y = beatAreaHeight - this.vPad;

            // Highlight the current beat tile
            if (this.tiles[this.currentMainIndex]) {
                const tile = this.tiles[this.currentMainIndex];
                this.ctx.fillStyle = this.theme.masterColor;
                this.ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
            }

            // Draw cursor rectangle
            this.ctx.fillStyle = this.theme.masterColor;
            this.ctx.fillRect(x, y, this.cursorWidth, cursorHeight);
        }

        // Offset cursor
        if (this.currentOtherIndex >= 0 && this.currentOtherIndex < this.data.beats.length) {
            const beat = this.data.beats[this.currentOtherIndex];
            const x = this.hPad + trackWidth * beat.start / this.data.duration - this.cursorWidth / 2;
            const y = beatAreaHeight - this.vPad / 2;

            // Highlight the offset beat tile
            if (this.tiles[this.currentOtherIndex]) {
                const tile = this.tiles[this.currentOtherIndex];
                this.ctx.fillStyle = this.theme.otherColor;
                this.ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
            }

            // Draw cursor rectangle
            this.ctx.fillStyle = this.theme.otherColor;
            this.ctx.fillRect(x, y, this.cursorWidth, cursorHeight);
        }

        // Draw legend
        this.drawLegend(beatAreaHeight);
    }

    private drawLegend(beatAreaHeight: number) {
        const padding = 15;
        const { width } = this.container.getBoundingClientRect();
        const y = beatAreaHeight + this.sectionHeight + 30;

        this.ctx.font = "11px sans-serif";
        this.ctx.textAlign = "left";

        // Main indicator
        this.ctx.fillStyle = this.theme.masterColor;
        this.ctx.beginPath();
        this.ctx.arc(padding + 6, y, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        this.ctx.fillText("Main Track", padding + 16, y + 4);

        // Offset indicator
        const offsetX = padding + 110;
        this.ctx.fillStyle = this.theme.otherColor;
        this.ctx.beginPath();
        this.ctx.arc(offsetX + 6, y, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        this.ctx.fillText("Offset Track", offsetX + 16, y + 4);

        // Time display
        if (this.currentMainIndex >= 0 && this.data) {
            const beat = this.data.beats[this.currentMainIndex];
            if (beat) {
                const time = this.formatTime(beat.start);
                this.ctx.textAlign = "right";
                this.ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                this.ctx.fillText(time, width - padding, y + 4);
            }
        }
    }

    private formatTime(seconds: number): string {
        const totalSecs = Math.floor(seconds);
        const hours = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        const pad = (n: number) => n.toString().padStart(2, "0");
        return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
    }
}
