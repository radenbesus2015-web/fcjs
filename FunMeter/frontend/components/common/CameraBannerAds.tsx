"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useI18n } from "@/components/providers/I18nProvider";
import { useSettings } from "@/components/providers/SettingsProvider";

interface CameraBannerAdsProps {
  bannerSrc?: string;
  adImages?: string[];
  intervalMs?: number;
  className?: string;
}

const DEFAULT_AD_IMAGES = [
  "/images/upskilling.png",
  "/images/nobox.jpg",
  "/images/karyasmk.jpg",
  "/images/expo.jpg",
  "/images/eschool.png",
];

export function CameraBannerAds({
  bannerSrc = "/images/header.png",
  adImages = DEFAULT_AD_IMAGES,
  intervalMs = 3000,
  className = "",
}: CameraBannerAdsProps) {
  const { t } = useI18n();
  const { useSetting } = useSettings();
  const { model: attSendWidth } = useSetting("attendance.sendWidth", { clamp: { min: 160, max: 1920, round: true } });

  // Camera
  const [cameraStatus, setCameraStatus] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: (attSendWidth as number) || 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraStatus(t("home.camera.status.started", "Kamera aktif"));
    } catch (err) {
      const msg = (err as { message?: string })?.message || "-";
      setCameraStatus(t("home.camera.status.error", "Kesalahan: {message}", { message: msg }));
    }
  }, [t, attSendWidth]);

  const stopCamera = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraStatus(t("home.camera.status.stopped", "Kamera dihentikan"));
  }, [t]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  // Ads rotation
  const [adIndex, setAdIndex] = useState(0);
  useEffect(() => {
    // Preload to ensure instant switch with no flicker
    adImages.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });
  }, [adImages]);

  useEffect(() => {
    const id = setInterval(() => {
      setAdIndex((i) => (i + 1) % adImages.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [adImages.length, intervalMs]);

  return (
    <div className={className}>
      <div className="grid gap-6 items-start">
        <div>
          {/* Banner */}
          <div>
            <Image
              src={bannerSrc}
              alt="Header"
              width={1920}
              height={400}
              priority
              className="w-full h-auto"
            />
          </div>

          {/* Video */}
          <div className="overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-auto"
            />
          </div>

          {/* Advertisement */}
          <div>
            <div className="relative w-full" style={{ minHeight: 400 }}>
              {adImages.map((src, idx) => (
                <Image
                  key={src}
                  src={src}
                  alt="Iklan"
                  width={1920}
                  height={400}
                  priority
                  className={`${idx === adIndex ? "opacity-100" : "opacity-0"} transition-none w-full h-auto absolute top-0 left-0`}
                  aria-hidden={idx === adIndex ? false : true}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CameraBannerAds;


