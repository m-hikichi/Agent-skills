/** One second of transport followed by a short arrival emphasis, independent of fps. */
export const flowProgress = (frame: number, fps: number, staticPreview = false) => {
  const progress = staticPreview ? 1 : Math.min(1, Math.max(0, frame / Math.max(1, fps)));
  const arrival = staticPreview ? 1 : Math.min(1, Math.max(0, (frame / Math.max(1, fps) - 1) / 0.3));
  return {progress, arrival};
};
