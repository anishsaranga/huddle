"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/TextField";
import { listTimezones } from "@/lib/admin/timezones";

type GroupFormProps = {
  initial: { name: string; timezone: string };
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onClearError: () => void;
  onSubmit: (values: { name: string; timezone: string }) => void;
};

/** Name + timezone form, rendered inside a Sheet (so it remounts, and resets, on each open). */
export function GroupForm({ initial, submitLabel, pending, error, onClearError, onSubmit }: GroupFormProps) {
  const [name, setName] = useState(initial.name);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [nameError, setNameError] = useState<string | null>(null);

  const zones = useMemo(() => {
    const all = listTimezones();
    return all.includes(initial.timezone) ? all : [initial.timezone, ...all];
  }, [initial.timezone]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setNameError("Enter a group name");
    if (trimmed.length > 40) return setNameError("Keep it to 40 characters or fewer");
    setNameError(null);
    onSubmit({ name: trimmed, timezone });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        label="Name"
        autoComplete="off"
        maxLength={60}
        placeholder="Sunday runners"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setNameError(null);
          onClearError();
        }}
        error={nameError ?? error}
        hint={`${name.trim().length}/40`}
      />
      <SelectField
        label="Timezone"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
        hint="Days, weeks and leaderboards roll over in this timezone."
      >
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replaceAll("_", " ")}
          </option>
        ))}
      </SelectField>
      <Button type="submit" size="lg" fullWidth loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
