// components/layout/GlobalModals.tsx
// Client component wrapper untuk lazy load modals

"use client";

import dynamic from "next/dynamic";

// Lazy load modals untuk performa lebih baik (hanya dimuat saat dibutuhkan)
const GlobalConfirm = dynamic(
  () => import("@/components/modals/GlobalConfirm"),
  { ssr: false }
);

const SettingsModal = dynamic(
  () => import("@/components/modals/SettingsModal"),
  { ssr: false }
);

const LoginModal = dynamic(
  () => import("@/components/modals/LoginModal"),
  { ssr: false }
);

export function GlobalModals() {
  return (
    <>
      <LoginModal />
      <GlobalConfirm />
      <SettingsModal />
    </>
  );
}
