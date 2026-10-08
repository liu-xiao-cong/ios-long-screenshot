/** Pure pixel matching. Coordinates are top-to-bottom canvas rows. */
function valid(a, b) {
  return a && b && a.width >= 16 && a.height >= 32 && a.width === b.width && a.height === b.height &&
    a.pixels.length === a.width * a.height && b.pixels.length === b.width * b.height;
}
function score(a, b, shift, rowStep = 3) {
  const w = a.width, h = a.height;
  let sum = 0, energy = 0, n = 0;
  for (let y = 2; y < h - shift - 2; y += rowStep) {
    for (let x = Math.floor(w * .1); x < w * .9; x += 3) {
      const p = a.pixels[(y + shift) * w + x], q = b.pixels[y * w + x];
      sum += Math.abs(p - q);
      energy += Math.abs(q - b.pixels[(y + 1) * w + x]);
      n++;
    }
  }
  return n && energy / n > .8 ? sum / n : Infinity;
}
export function matchFrames(a, b) {
  if (!valid(a, b)) return null;
  const scores = [];
  for (let shift = 0; shift <= Math.floor(a.height * .7); shift++) scores.push({ shift, error: score(a, b, shift) });
  scores.sort((x, y) => x.error - y.error);
  const best = scores[0];
  if (!best || !Number.isFinite(best.error) || best.error > 18) return null;
  const alternate = scores.find(x => Math.abs(x.shift - best.shift) > 3);
  if (alternate && alternate.error - best.error < .8) return null;
  return best;
}
export function refineShift(a, b, estimate, radius) {
  if (!valid(a, b)) return null;
  let best = null;
  for (let shift = Math.max(0, Math.floor(estimate - radius)); shift <= Math.min(a.height - 24, Math.ceil(estimate + radius)); shift++) {
    const error = score(a, b, shift, 5);
    if (Number.isFinite(error) && (!best || error < best.error)) best = { shift, error };
  }
  return best && best.error <= 20 ? best : null;
}
