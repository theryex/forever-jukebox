/**
 * Canonizer Visualization
 *
 * A specialized visualization for the Autocanonizer that shows two playhead positions:
 * - Main track position (primary playhead)
 * - Offset track position (secondary playhead)
 *
 * This creates a visual representation of the "canon" effect where two copies of the song
 * play at different positions simultaneously.
 */

import type { CanonizerBeat } from "../engine/CanonizerEngine";

interface CanonizerVisualizationData {
    beats: CanonizerBeat[];
    duration: number;
}

export class CanonizerViz {
    private container: HTMLElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    private data: CanonizerVisualizationData | null = null;
    private positions: Array<{ x: number; y: number }> = [];
    private center = { x: 0, y: 0 };
    private radius = 0;

    private currentMainIndex = -1;
    private currentOtherIndex = -1;

    private visible = true;

    private theme = {
        beatFill: "rgba(255, 215, 130, 0.4)",
        mainPlayhead: "#ffd46a",
        otherPlayhead: "#4ac7ff",
        connectionLine: "rgba(255, 255, 255, 0.3)",
        ringStroke: "rgba(255, 255, 255, 0.1)",
        sectionMarker: "rgba(255, 255, 255, 0.15)",
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
            this.draw();
        }
    }

    setData(data: CanonizerVisualizationData) {
        this.data = data;
        this.computePositions();
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
        this.canvas.style.zIndex = "100"; // Ensure on top of other viz canvases
        this.canvas.style.pointerEvents = "none"; // Don't block mouse events
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
            this.computePositions();
            this.draw();
        }
    }

    private computePositions() {
        if (!this.data) {
            return;
        }
        const { width, height } = this.container.getBoundingClientRect();
        const count = this.data.beats.length;

        this.center = { x: width / 2, y: height / 2 };
        this.radius = Math.min(width, height) * 0.38;

        // Arrange beats in a circle
        this.positions = Array.from({ length: count }, (_, i) => {
            const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
            return {
                x: this.center.x + Math.cos(angle) * this.radius,
                y: this.center.y + Math.sin(angle) * this.radius,
            };
        });
    }

    private updateTheme() {
        const styles = getComputedStyle(document.documentElement);
        this.theme.beatFill =
            styles.getPropertyValue("--beat-fill").trim() || this.theme.beatFill;
        this.theme.mainPlayhead =
            styles.getPropertyValue("--beat-highlight").trim() ||
            this.theme.mainPlayhead;
        this.theme.otherPlayhead =
            styles.getPropertyValue("--edge-stroke-bright").trim() ||
            this.theme.otherPlayhead;
    }

    private draw() {
        const { width, height } = this.container.getBoundingClientRect();
        this.ctx.clearRect(0, 0, width, height);
        if (!this.data || !this.visible) {
            return;
        }

        this.ctx.save();

        // Draw outer ring
        this.ctx.strokeStyle = this.theme.ringStroke;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(this.center.x, this.center.y, this.radius, 0, Math.PI * 2);
        this.ctx.stroke();

        // Draw beat dots
        this.ctx.fillStyle = this.theme.beatFill;
        for (const p of this.positions) {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw connection line between the two playheads
        if (this.currentMainIndex >= 0 && this.currentOtherIndex >= 0) {
            const mainPos = this.positions[this.currentMainIndex];
            const otherPos = this.positions[this.currentOtherIndex];
            if (mainPos && otherPos) {
                // Draw curved connection through center
                this.ctx.strokeStyle = this.theme.connectionLine;
                this.ctx.lineWidth = 1.5;
                this.ctx.beginPath();
                this.ctx.moveTo(mainPos.x, mainPos.y);
                this.ctx.quadraticCurveTo(
                    this.center.x,
                    this.center.y,
                    otherPos.x,
                    otherPos.y
                );
                this.ctx.stroke();
            }
        }

        // Draw offset track playhead (secondary - blue)
        if (this.currentOtherIndex >= 0) {
            const otherPos = this.positions[this.currentOtherIndex];
            if (otherPos) {
                // Outer glow
                this.ctx.fillStyle = "rgba(74, 199, 255, 0.3)";
                this.ctx.beginPath();
                this.ctx.arc(otherPos.x, otherPos.y, 12, 0, Math.PI * 2);
                this.ctx.fill();

                // Inner circle
                this.ctx.fillStyle = this.theme.otherPlayhead;
                this.ctx.beginPath();
                this.ctx.arc(otherPos.x, otherPos.y, 6, 0, Math.PI * 2);
                this.ctx.fill();

                // Label
                this.ctx.fillStyle = "rgba(74, 199, 255, 0.8)";
                this.ctx.font = "10px sans-serif";
                this.ctx.textAlign = "center";
                this.ctx.fillText("OFFSET", otherPos.x, otherPos.y - 16);
            }
        }

        // Draw main track playhead (primary - gold/yellow)
        if (this.currentMainIndex >= 0) {
            const mainPos = this.positions[this.currentMainIndex];
            if (mainPos) {
                // Outer glow
                this.ctx.fillStyle = "rgba(255, 212, 106, 0.3)";
                this.ctx.beginPath();
                this.ctx.arc(mainPos.x, mainPos.y, 14, 0, Math.PI * 2);
                this.ctx.fill();

                // Inner circle
                this.ctx.fillStyle = this.theme.mainPlayhead;
                this.ctx.beginPath();
                this.ctx.arc(mainPos.x, mainPos.y, 8, 0, Math.PI * 2);
                this.ctx.fill();

                // Label
                this.ctx.fillStyle = "rgba(255, 212, 106, 0.8)";
                this.ctx.font = "10px sans-serif";
                this.ctx.textAlign = "center";
                this.ctx.fillText("MAIN", mainPos.x, mainPos.y - 18);
            }
        }

        // Draw legend in corner
        this.drawLegend();

        this.ctx.restore();
    }

    private drawLegend() {
        const padding = 15;
        const y = this.container.getBoundingClientRect().height - padding;

        this.ctx.font = "11px sans-serif";
        this.ctx.textAlign = "left";

        // Main indicator
        this.ctx.fillStyle = this.theme.mainPlayhead;
        this.ctx.beginPath();
        this.ctx.arc(padding + 6, y - 6, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        this.ctx.fillText("Main Track", padding + 16, y - 2);

        // Offset indicator
        const offsetX = padding + 100;
        this.ctx.fillStyle = this.theme.otherPlayhead;
        this.ctx.beginPath();
        this.ctx.arc(offsetX + 6, y - 6, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        this.ctx.fillText("Offset Track", offsetX + 16, y - 2);
    }
}
