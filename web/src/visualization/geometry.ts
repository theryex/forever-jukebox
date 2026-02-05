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

function dist2(v: Point, w: Point) {
    return sqr(v.x - w.x) + sqr(v.y - w.y);
}

function distToSegmentSquared(p: Point, v: Point, w: Point) {
    const l2 = dist2(v, w);
    if (l2 === 0) {
        return dist2(p, v);
    }
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist2(p, {
        x: v.x + t * (w.x - v.x),
        y: v.y + t * (w.y - v.y),
    });
}

export function distanceToSegment(p: Point, v: Point, w: Point) {
    return Math.sqrt(distToSegmentSquared(p, v, w));
}

// Approximate distance to quadratic bezier
export function distanceToQuadratic(
    p: Point,
    p0: Point,
    p1: Point,
    p2: Point,
) {
    // We'll sample a few points for a rough approximation or use a simplified bounding approach if needed,
    // but for hit testing, flattening to segments is often enough. 
    // However, for a simple implementation, let's treat it as two segments p0-p1 and p1-p2 or evaluate t.
    // A better approach for click detection is searching for the closest t.
    // Simplified: check distance to segments p0-p1, p1-p2, and p0-p2? No, that's bad for curves.
    // Let's iterate t.
    let minD2 = Infinity;
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
        const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
        const d2 = sqr(p.x - x) + sqr(p.y - y);
        if (d2 < minD2) {
            minD2 = d2;
        }
    }
    return Math.sqrt(minD2);
}
