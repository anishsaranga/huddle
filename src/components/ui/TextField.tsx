"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";

const control =
  "h-12 w-full rounded-xl bg-card-sunken px-4 text-[16px] text-text placeholder:text-dim shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1px_var(--hairline-strong)] outline-none transition-shadow focus-visible:shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1.5px_rgb(255_255_255/0.6)] disabled:opacity-50";

type FieldShellProps = {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  id: string;
  children: ReactNode;
};

function FieldShell({ label, error, hint, id, children }: FieldShellProps) {
  return (
    <div>
      <label htmlFor={id} className="label mb-2 block">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" className="mt-2 text-[13px] leading-snug text-recovery-red">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="mt-2 text-[13px] leading-snug text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  /** Muted text inside the left edge (e.g. "@"). */
  leading?: ReactNode;
  /** Slot inside the right edge (a unit, a status icon). */
  trailing?: ReactNode;
};

/** Labelled text input (16px, so iOS doesn't zoom on focus). */
export function TextField({ label, error, hint, leading, trailing, className = "", ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <div className="relative">
        {leading && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-muted"
          >
            {leading}
          </span>
        )}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          className={`${control} ${leading ? "pl-9" : ""} ${trailing ? "pr-14" : ""} ${className}`}
          {...rest}
        />
        {trailing && (
          <span className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center text-muted">{trailing}</span>
        )}
      </div>
    </FieldShell>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  label: string;
  error?: string | null;
  hint?: ReactNode;
};

/** Labelled native select (best picker on mobile). */
export function SelectField({ label, error, hint, className = "", children, ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          className={`${control} appearance-none pr-10 ${className}`}
          {...rest}
        >
          {children}
        </select>
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted"
        >
          <path d="m4 6.5 4 4 4-4" />
        </svg>
      </div>
    </FieldShell>
  );
}
