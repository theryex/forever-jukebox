export function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    const sx = px - x1;
    const sy = py - y1;
    return Math.sqrt(sx * sx + sy * sy);
  }
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const cx = x1 + clamped * dx;
  const cy = y1 + clamped * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

export function distanceToQuadratic(
  px: number,
  py: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number
): number {
  const samples = 24;
  let best = Infinity;
  let prevX = x1;
  let prevY = y1;
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const mt = 1 - t;
    const qx = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
    const qy = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
    const dist = distanceToSegment(px, py, prevX, prevY, qx, qy);
    if (dist < best) {
      best = dist;
    }
    prevX = qx;
    prevY = qy;
  }
  return best;
}
