import { matchFrames, refineShift } from './matcher.js';
self.onmessage = ({ data }) => {
  try {
    const coarse = matchFrames(data.previous.coarse, data.current.coarse);
    if (!coarse) { self.postMessage(null); return; }
    const scale = data.current.fine.height / data.current.coarse.height;
    self.postMessage(refineShift(data.previous.fine, data.current.fine, coarse.shift * scale, Math.ceil(scale) + 2));
  } catch (error) { self.postMessage({ failure: error.message }); }
};
