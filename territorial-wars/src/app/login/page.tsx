"use client";

import { EntryGate } from "@/components/EntryGate";
import { useEffect, useState } from "react";

const INVITE_KEY = "itw_invite";

function playCallbackUrl(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search)
      .get("invite")
      ?.trim()
      .toUpperCase();
    if (fromUrl) {
      window.localStorage.setItem(INVITE_KEY, fromUrl);
      return `/play?invite=${encodeURIComponent(fromUrl)}`;
    }
    const stored = window.localStorage.getItem(INVITE_KEY);
    if (stored) return `/play?invite=${encodeURIComponent(stored)}`;
  } catch {
    /* ignore */
  }
  return "/play";
}

export default function LoginPage() {
  const [callbackUrl, setCallbackUrl] = useState("/play");

  useEffect(() => {
    setCallbackUrl(playCallbackUrl());
  }, []);

  return <EntryGate mode="signin" callbackUrl={callbackUrl} />;
}
