import { useEffect, useState } from 'react';

const clock = () => ({ perf: performance.now(), wall: Date.now() });

// Re-render on an interval for values that live outside React (countdowns, recording progress).
// Returns the time of the latest tick, so components never read the clock during render.
export function useTick(ms) {
  const [now, set] = useState(clock);
  useEffect(() => {
    const id = setInterval(() => set(clock()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
