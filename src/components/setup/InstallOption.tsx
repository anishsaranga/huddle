"use client";

import { motion } from "motion/react";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { spring } from "@/lib/ui/motion";
import { CopyChip, Kbd, NumberedList, Tip } from "./primitives";

type InstallOptionProps = {
  shortcutName: string;
  /** iCloud share link (SHORTCUT_ICLOUD_URL), when the admin has published one. */
  icloudUrl: string | null;
  /** Public path of the downloadable .shortcut file, when it is on the server. */
  shortcutFileUrl: string | null;
  ingestUrl: string;
  /** The just-revealed key, so it can be copied right here. */
  revealed: string | null;
};

const DownloadGlyph = () => (
  <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
  </svg>
);

const BUTTON = "flex h-[56px] w-full items-center justify-center gap-2.5 rounded-full text-[14px] font-semibold uppercase tracking-[0.12em]";
const PRIMARY_STYLE = {
  background: SIGNAL.strain,
  boxShadow: `0 0 0 1px ${alpha(SIGNAL.strain, 60)} inset, 0 10px 30px -10px ${alpha(SIGNAL.strain, 80)}`,
};

/**
 * "Option A · Install in one tap": the iCloud link and/or a direct .shortcut download (whichever the admin
 * has set up; the iCloud link is the primary button when both exist), the shared 3 steps, or a
 * "not published yet" card when neither exists.
 */
export function InstallOption({ shortcutName, icloudUrl, shortcutFileUrl, ingestUrl, revealed }: InstallOptionProps) {
  if (!icloudUrl && !shortcutFileUrl) {
    return (
      <div className="surface p-5" data-testid="icloud-missing">
        <p className="telemetry" style={{ color: SIGNAL.yellow }}>
          {"// Install link not published yet"}
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-text-2">
          Your Huddle admin hasn&rsquo;t shared the one-tap install yet.
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
          Build it yourself below: about 15 minutes, once. Or ask your admin for the link.
        </p>
      </div>
    );
  }

  const downloadPrimary = !icloudUrl;
  return (
    <div className="surface surface-elevated p-5">
      <div className="space-y-3">
        {icloudUrl && (
          <motion.a
            href={icloudUrl}
            target="_blank"
            rel="noopener noreferrer"
            whileTap={{ scale: 0.97 }}
            transition={spring.press}
            data-testid="icloud-install"
            className={`${BUTTON} text-bg`}
            style={PRIMARY_STYLE}
          >
            <DownloadGlyph />
            Get {shortcutName}
          </motion.a>
        )}
        {shortcutFileUrl && (
          <motion.a
            href={shortcutFileUrl}
            download
            whileTap={{ scale: 0.97 }}
            transition={spring.press}
            data-testid="shortcut-download"
            data-variant={downloadPrimary ? "primary" : "secondary"}
            className={
              downloadPrimary
                ? `${BUTTON} text-bg`
                : `${BUTTON} bg-white/[0.03] text-text shadow-[inset_0_0_0_1px_var(--hairline-strong),inset_0_1px_0_rgb(255_255_255/0.06)]`
            }
            style={downloadPrimary ? PRIMARY_STYLE : undefined}
          >
            <DownloadGlyph />
            Download .shortcut file
          </motion.a>
        )}
      </div>
      <div className="mt-5">
        <NumberedList
          items={[
            <>
              Tap {icloudUrl ? <Kbd>Get {shortcutName}</Kbd> : <Kbd>Download .shortcut file</Kbd>}
              {icloudUrl && shortcutFileUrl && (
                <>
                  {" "}
                  (or <Kbd>Download .shortcut file</Kbd>)
                </>
              )}
              , then <Kbd>Add Shortcut</Kbd>. Keep its name.
            </>,
            <>
              When it asks, paste your URL <CopyChip value={ingestUrl} label="Ingest URL" /> and your key
              {revealed ? (
                <>
                  {" "}
                  <CopyChip value={revealed} label="Key" />
                </>
              ) : (
                <> from the card above (use Show a new key to get a copyable one)</>
              )}
            </>,
            <>Run it once from the Shortcuts app and allow Health access.</>,
          ]}
        />
      </div>
      {shortcutFileUrl && (
        <Tip>
          Using the file: Safari shows a download. Tap it and it opens in Shortcuts, ready to add.
        </Tip>
      )}
    </div>
  );
}
