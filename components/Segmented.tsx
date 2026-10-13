"use client";

import type { ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
};

// A radio group that looks like a pill switch. Arrow keys move between options.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  iconOnly = false,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  iconOnly?: boolean;
}) {
  const enabled = options.filter((o) => !o.disabled);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + (e.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
    onChange(next.value);
    (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={`segmented${iconOnly ? " icon-only" : ""}`} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.title}
          aria-label={iconOnly ? o.title : undefined}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
