import { OG_ALT, OG_SIZE } from "@/lib/site";
import { renderOgImage } from "./_og/render";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOgImage();
}
