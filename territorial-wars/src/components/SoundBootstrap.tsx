"use client";

import { useEffect } from "react";
import { installUiSounds, unlockAudio } from "@/lib/sound";

/** Global UI click/hover SFX for every page. */
export function SoundBootstrap() {
  useEffect(() => {
    installUiSounds();
    const unlock = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  return null;
}
