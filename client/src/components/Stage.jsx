import { useEffect, useRef } from 'react';
import { mountEngine } from '../engine/engine.js';

// The artwork: WebGL field, Canvas 2D particles, HUD overlay. The engine owns the pixels.
export default function Stage() {
  const gl = useRef(null), c = useRef(null), h = useRef(null);
  useEffect(() => { mountEngine({ gl: gl.current, c: c.current, h: h.current }); }, []);
  return (
    <>
      <canvas id="gl" ref={gl} />
      <canvas id="c" ref={c} />
      <canvas id="h" ref={h} />
    </>
  );
}
