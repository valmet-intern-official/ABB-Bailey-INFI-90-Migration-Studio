"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const SRC = "/media/herosection.mp4";
const POSTER = "/media/herosection-poster.webp";

type NetworkInfo = { saveData?: boolean };

export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const saveData = (navigator as Navigator & { connection?: NetworkInfo }).connection?.saveData === true;
    const update = () => setAllowed(!reduce.matches && !saveData);
    update();
    reduce.addEventListener("change", update);
    return () => reduce.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!allowed) {
      video.pause();
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => setPlaying(false));
        else video.pause();
      },
      { threshold: 0.15 }
    );
    io.observe(video);
    return () => io.disconnect();
  }, [allowed]);

  return (
    <div className="lp-hero-video" data-playing={playing || undefined}>
      <Image
        src={POSTER}
        alt=""
        fill
        priority
        sizes="(min-width: 1100px) 64vw, 100vw"
        className="lp-hero-video__poster"
      />
      <video
        ref={ref}
        className="lp-hero-video__media"
        muted
        playsInline
        loop
        preload="metadata"
        poster={POSTER}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        aria-label="ABB Bailey INFI 90 controller rack in front of a process plant, with a control schematic fading in on the left"
      >
        <source src={SRC} type="video/mp4" />
      </video>
    </div>
  );
}
