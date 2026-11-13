/** Downscale + JPEG-compress a captured/picked photo for upload, plus a small thumbnail. */
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { fitLongEdge, THUMB_LONG_EDGE, THUMB_QUALITY, UPLOAD_LONG_EDGE, UPLOAD_QUALITY } from "../logic/image";

export interface PreparedPhoto {
  uri: string;
  base64: string;
  thumbnail: string | null;
  width: number;
  height: number;
}

async function render(uri: string, width: number, height: number, longEdge: number, quality: number) {
  const ctx = ImageManipulator.manipulate(uri);
  const size = fitLongEdge(width, height, longEdge);
  if (size) ctx.resize(size);
  const image = await ctx.renderAsync();
  // Always re-encode: converts HEIC/PNG to JPEG and strips EXIF (incl. location).
  return image.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
}

export async function preparePhoto(uri: string, width: number, height: number): Promise<PreparedPhoto> {
  const main = await render(uri, width, height, UPLOAD_LONG_EDGE, UPLOAD_QUALITY);
  if (!main.base64) throw new Error("Image encoder returned no data");
  let thumbnail: string | null = null;
  try {
    const t = await render(main.uri, main.width, main.height, THUMB_LONG_EDGE, THUMB_QUALITY);
    if (t.base64) thumbnail = `data:image/jpeg;base64,${t.base64}`;
  } catch {
    thumbnail = null;
  }
  const base64 = main.base64.replace(/^data:[^,]+,/, "");
  return { uri: main.uri, base64, thumbnail, width: main.width, height: main.height };
}
