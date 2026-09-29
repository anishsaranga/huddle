import { notFound } from "next/navigation";
import { Showcase } from "./Showcase";

export const metadata = { title: "UI kit" };

/** Dev-only component showcase. 404s in production builds. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Showcase />;
}
