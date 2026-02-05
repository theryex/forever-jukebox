export type Point = { x: number; y: number };

export function isPointInPolygon(obj: Point, poly: Point[]) {
    const x = obj.x;
    const y = obj.y;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x;
        const yi = poly[i].y;
        const xj = poly[j].x;
        const yj = poly[j].y;
        const intersect =
            yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) {
            inside = !inside;
        }
    }
    return inside;
}

function sqr(x: number) {
    return x * x;
}

function dist2(vx: number, vy: number, wx: number, wy: number) {
    return sqr(vx - wx) + sqr(vy - wy);
}

function distToSegmentSquared(
    px: number,
    py: number,
    vx: number,
    vy: number,
    wx: number,
    wy: number,
) {
    const l2 = dist2(vx, vy, wx, wy);
    if (l2 === 0) {
        return dist2(px, py, vx, vy);
    }
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist2(px, py, vx + t * (wx - vx), vy + t * (wy - vy));
}

export function distanceToSegment(
    px: number,
    py: number,
    vx: number,
    vy: number,
    wx: number,
    wy: number,
) {
    return Math.sqrt(distToSegmentSquared(px, py, vx, vy, wx, wy));
}

export function distanceToQuadratic(
    px: number,
    py: number,
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
) {
    let minD2 = Infinity;
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x =
            (1 - t) * (1 - t) * p0x + 2 * (1 - t) * t * p1x + t * t * p2x;
        const y =
            (1 - t) * (1 - t) * p0y + 2 * (1 - t) * t * p1y + t * t * p2y;
        const d2 = sqr(px - x) + sqr(py - y);
        if (d2 < minD2) {
            minD2 = d2;
        }
    }
    return Math.sqrt(minD2);
}
