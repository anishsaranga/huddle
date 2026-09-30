import type { Metadata } from "next";
import { InstallGuide } from "@/components/pwa/InstallGuide";
import { publicPageMetadata } from "@/lib/site";

export const metadata: Metadata = publicPageMetadata({
  title: "Install",
  description: "Add Huddle to your iPhone Home Screen from Safari: tap Share, Add to Home Screen, then open it like an app.",
  path: "/install",
});

// Shared in chats, so its link preview should carry the runtime APP_URL rather than the build-time one.
export const dynamic = "force-dynamic";

export default function InstallPage() {
  return <InstallGuide />;
}
