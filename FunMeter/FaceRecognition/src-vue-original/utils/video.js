// Compatibility wrapper: delegate to overlay.js so we have a single source of truth
import { fitCanvasToVideo as _fitCanvasToVideo, drawResultsOverlay } from './overlay';

export const fitCanvasToVideo = _fitCanvasToVideo;

// Keep old signature (video, canvas, results, sendHeight, sendWidth)
// and forward to drawResultsOverlay with proper options.
export function drawResultsOnOverlay(video, canvas, results, sendHeight, sendWidth = 480) {
  return drawResultsOverlay(video, canvas, results, {
    mode: 'recognize',
    sendWidth: Number(sendWidth) || 480,
    sendHeight: Number(sendHeight) || 0,
    fitMode: 'fill',
  });
}
