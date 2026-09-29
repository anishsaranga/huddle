"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import type { AvatarConfig } from "@/lib/avatar/key";
import { spring } from "@/lib/ui/motion";
import { PhotoCropper } from "./PhotoCropper";

/*
 * "Build a character" or "Upload photo". The customizer (DiceBear styles,
 * ~440 KB gz) is loaded on demand; the cropper and upload are light.
 */

export type AvatarDraft = {
  mode: "character" | "upload";
  config: AvatarConfig;
  /** Preview URL of the uploaded photo (blob: right after upload, /api/avatar otherwise), or null. */
  photoUrl: string | null;
};

function CustomizerSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the character builder">
      <Skeleton className="mx-auto aspect-square w-full max-w-[300px]" rounded="full" />
      <div className="flex gap-2">
        <Skeleton className="size-11" rounded="full" />
        <Skeleton className="size-11" rounded="full" />
        <Skeleton className="size-11" rounded="full" />
        <Skeleton className="ml-auto h-11 w-36" rounded="full" />
      </div>
      <Skeleton className="h-24 w-full" rounded="lg" />
      <Skeleton className="h-64 w-full" rounded="lg" />
    </div>
  );
}

const AvatarCustomizer = dynamic(
  () => import("@/components/avatar/AvatarCustomizer").then((m) => m.AvatarCustomizer),
  { ssr: false, loading: () => <CustomizerSkeleton /> },
);

/** POST the cropped square to /api/me/avatar. Resolves to an error message, or null on success. */
export async function uploadAvatarBlob(blob: Blob): Promise<string | null> {
  const body = new FormData();
  body.append("file", blob, "avatar.jpg");
  try {
    const res = await fetch("/api/me/avatar", { method: "POST", body });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return data?.error ?? "Couldn't upload your photo. Try again.";
  } catch {
    return "Couldn't reach the server. Check your connection and try again.";
  }
}

const CameraIcon = () => (
  <svg aria-hidden width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 10.5a2 2 0 0 1 2-2h2.2l1.5-2.5h9.6l1.5 2.5h2.2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-19a2 2 0 0 1-2-2z" />
    <circle cx="15" cy="15.5" r="4.6" />
  </svg>
);

function PhotoPanel({ photoUrl, onUploaded }: { photoUrl: string | null; onUploaded: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const pick = () => inputRef.current?.click();

  return (
    <div className="flex flex-col items-center pt-4 text-center">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Choose a photo"
        data-testid="avatar-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // allow re-picking the same file
          if (f) setFile(f);
        }}
      />

      <div className="relative">
        {photoUrl ? (
          <motion.div key={photoUrl} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.soft}>
            <Avatar src={photoUrl} label="Your photo" size={160} alt="Your photo" ring="var(--strain)" />
          </motion.div>
        ) : (
          <button
            type="button"
            onClick={pick}
            aria-label="Choose a photo"
            className="grid size-[160px] place-items-center rounded-full text-muted shadow-[inset_0_0_0_1.5px_var(--hairline-strong)]"
            style={{ background: "repeating-conic-gradient(from 0deg, rgb(255 255 255 / 0.025) 0 10deg, transparent 10deg 20deg), var(--card-sunken)" }}
          >
            <span className="flex flex-col items-center gap-2">
              <CameraIcon />
              <span className="telemetry">Add photo</span>
            </span>
          </button>
        )}
      </div>

      <div className="mt-6 w-full max-w-[280px]">
        <Button variant={photoUrl ? "secondary" : "primary"} size="lg" fullWidth onClick={pick}>
          {photoUrl ? "Replace photo" : "Choose photo"}
        </Button>
      </div>

      <p className="mt-4 max-w-[32ch] text-[13px] leading-relaxed text-muted">
        {photoUrl
          ? "Looking good. You can swap it any time from your profile."
          : "Pinch and drag to fit the circle. Photos are cropped, resized and kept private."}
      </p>

      {file && (
        <PhotoCropper
          file={file}
          onCancel={() => setFile(null)}
          onPickAnother={() => {
            setFile(null);
            pick();
          }}
          onConfirm={async (blob) => {
            const error = await uploadAvatarBlob(blob);
            if (error) return error;
            onUploaded(URL.createObjectURL(blob));
            setFile(null);
            return null;
          }}
        />
      )}
    </div>
  );
}

type AvatarPickerProps = {
  value: AvatarDraft;
  onChange: (next: AvatarDraft) => void;
};

/** Controlled avatar chooser shared by onboarding and the Profile avatar sheet. */
export function AvatarPicker({ value, onChange }: AvatarPickerProps) {
  return (
    <div className="space-y-5">
      <SegmentedControl<"character" | "upload">
        ariaLabel="Avatar type"
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        options={[
          { value: "character", label: "Build a character" },
          { value: "upload", label: "Upload photo" },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={value.mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {value.mode === "character" ? (
            <AvatarCustomizer value={value.config} onChange={(config) => onChange({ ...value, config })} />
          ) : (
            <PhotoPanel photoUrl={value.photoUrl}
              onUploaded={(photoUrl) => onChange({ ...value, mode: "upload", photoUrl })}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
