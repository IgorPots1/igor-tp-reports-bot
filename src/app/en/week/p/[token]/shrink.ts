/* Shrink a photo before upload: max 1600 px, JPEG 0.85, as a data URL.
 * Same as shrinkToDataUrl of the Intervals plan page (src/app/plan/[slug]/[token]/PlanView.tsx). */
export async function shrinkToDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const max = 1600;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}
