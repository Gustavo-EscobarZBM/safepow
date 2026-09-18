'use client';

import { useEffect, useState } from 'react';

const STEPS = 30;

export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target <= 0) {
      setValue(target);
      return;
    }

    setValue(0);
    let step = 0;
    const stepMs = durationMs / STEPS;
    const id = setInterval(() => {
      step += 1;
      const progress = Math.min(1, step / STEPS);
      setValue(target * progress);
      if (progress >= 1) clearInterval(id);
    }, stepMs);

    return () => clearInterval(id);
  }, [target, durationMs]);

  return value;
}
