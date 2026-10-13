"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";
import { Segmented } from "./Segmented";

type Theme = "system" | "light" | "dark";
const KEY = "inbox-helper-theme";

// Runs in <head> before paint so a saved theme doesn't flash the wrong colors.
export const themeInitScript = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function apply(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
  }, []);

  function change(t: Theme) {
    setTheme(t);
    apply(t);
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {}
  }

  return (
    <Segmented<Theme>
      label="Color theme"
      iconOnly
      value={theme}
      onChange={change}
      options={[
        { value: "system", label: <MonitorIcon />, title: "Use system theme" },
        { value: "light", label: <SunIcon />, title: "Light theme" },
        { value: "dark", label: <MoonIcon />, title: "Dark theme" },
      ]}
    />
  );
}
