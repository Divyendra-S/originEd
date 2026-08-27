// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

"use client";

import { useEffect, useState } from "react";

/** Matches breakpoints in `app/globals.css` */
const IPAD_MIN = 768;
const DESKTOP_SM_MIN = 1280;
const FULL_HD_MIN = 1920;

export type WaveArcsConfig = {
  lineWidth: number;
  lineCount: number;
};

/**
 * Edit lineWidth / lineCount per breakpoint here.
 * - mobile:   < 768
 * - ipad:     768 – 1279
 * - desktop:  1280 – 1919
 * - fullHd:   1920+
 */
export const WAVE_ARCS_BY_BREAKPOINT = {
  mobile: { lineWidth: 5, lineCount: 400 },
  ipad: { lineWidth: 5, lineCount: 400 },
  desktop: { lineWidth: 5, lineCount: 400 },
  fullHd: { lineWidth: 5, lineCount: 400 },
} as const satisfies Record<string, WaveArcsConfig>;

export const useWaveArcsConfig = (): WaveArcsConfig => {
  const [config, setConfig] = useState<WaveArcsConfig>(
    WAVE_ARCS_BY_BREAKPOINT.mobile,
  );

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;

      if (width < IPAD_MIN) {
        setConfig(WAVE_ARCS_BY_BREAKPOINT.mobile);
        return;
      }
      if (width < DESKTOP_SM_MIN) {
        setConfig(WAVE_ARCS_BY_BREAKPOINT.ipad);
        return;
      }
      if (width < FULL_HD_MIN) {
        setConfig(WAVE_ARCS_BY_BREAKPOINT.desktop);
        return;
      }
      setConfig(WAVE_ARCS_BY_BREAKPOINT.fullHd);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return config;
};
