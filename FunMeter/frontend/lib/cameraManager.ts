// lib/cameraManager.ts
// Simple singleton camera manager to share a single MediaStream across pages
// Pages that require camera should call attach(videoEl) on mount and detach on unmount.

let sharedStream: MediaStream | null = null;
let attachCount = 0;
const attachedElements: WeakSet<HTMLVideoElement> = new WeakSet();

const defaultConstraints: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: "user",
  },
  audio: false,
};

async function ensureStream(constraints: MediaStreamConstraints = defaultConstraints): Promise<MediaStream> {
  if (sharedStream) {
    return sharedStream;
  }
  sharedStream = await navigator.mediaDevices.getUserMedia(constraints);
  return sharedStream;
}

function stopStream(): void {
  if (sharedStream) {
    sharedStream.getTracks().forEach((t) => t.stop());
    sharedStream = null;
  }
}

export async function attach(videoEl: HTMLVideoElement, constraints?: MediaStreamConstraints): Promise<MediaStream> {
  const stream = await ensureStream(constraints);
  // Re-attach latest stream
  videoEl.srcObject = stream;
  if (!attachedElements.has(videoEl)) {
    attachedElements.add(videoEl);
    attachCount += 1;
  }
  await new Promise<void>((resolve) => {
    if (videoEl.readyState >= 2) return resolve();
    videoEl.onloadedmetadata = () => resolve();
  });
  return stream;
}

export function detach(videoEl?: HTMLVideoElement | null): void {
  if (videoEl && videoEl.srcObject) {
    videoEl.srcObject = null;
  }
  if (videoEl && attachedElements.has(videoEl)) {
    attachedElements.delete(videoEl);
    attachCount = Math.max(0, attachCount - 1);
  }
  if (attachCount === 0) {
    stopStream();
  }
}

export function isActive(): boolean {
  return !!sharedStream;
}

export function stopAll(): void {
  attachCount = 0;
  stopStream();
}

// Ensure camera stops on full page unload (navigation away / refresh)
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    stopAll();
  });
}
