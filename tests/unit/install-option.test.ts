import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstallOption } from "@/components/setup/InstallOption";
import { ToastProvider } from "@/components/ui/Toast";

const base = { shortcutName: "Huddle Sync", ingestUrl: "https://huddle.example.com/api/ingest", revealed: null };
const render = (icloudUrl: string | null, shortcutFileUrl: string | null) =>
  renderToStaticMarkup(createElement(ToastProvider, null, createElement(InstallOption, { ...base, icloudUrl, shortcutFileUrl })));

const ICLOUD = "https://www.icloud.com/shortcuts/abc123";
const FILE = "/shortcuts/huddle-sync.shortcut";

describe("Setup Option A states", () => {
  it("link only: the iCloud button, no download", () => {
    const html = render(ICLOUD, null);
    expect(html).toContain('data-testid="icloud-install"');
    expect(html).toContain(`href="${ICLOUD}"`);
    expect(html).not.toContain("shortcut-download");
    expect(html).not.toContain("icloud-missing");
    expect(html).not.toContain("Safari shows a download");
  });

  it("file only: the download is the primary button and the Safari hint shows", () => {
    const html = render(null, FILE);
    expect(html).toContain('data-testid="shortcut-download"');
    expect(html).toContain(`href="${FILE}"`);
    expect(html).toContain('download=""');
    expect(html).toContain('data-variant="primary"');
    expect(html).not.toContain("icloud-install");
    expect(html).not.toContain("icloud-missing");
    expect(html).toContain("Safari shows a download");
  });

  it("both: iCloud first, the download as the secondary button", () => {
    const html = render(ICLOUD, FILE);
    expect(html.indexOf("icloud-install")).toBeGreaterThan(-1);
    expect(html.indexOf("shortcut-download")).toBeGreaterThan(html.indexOf("icloud-install"));
    expect(html).toContain('data-variant="secondary"');
    expect(html).not.toContain("icloud-missing");
  });

  it("neither: the not-published card", () => {
    const html = render(null, null);
    expect(html).toContain('data-testid="icloud-missing"');
    expect(html).toContain("Install link not published yet");
    expect(html).not.toContain("icloud-install");
    expect(html).not.toContain("shortcut-download");
  });
});
