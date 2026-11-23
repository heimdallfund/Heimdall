"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Live WebGL Facet Shield: tilts toward the pointer, turns with scroll, idles with a slow sway.
 * Falls back to the pre-rendered image until WebGL is ready (or if it is unavailable / reduced motion).
 */
export function Shield3D({ size = 420, className = "" }: { size?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (disposed) return;
      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return; // no WebGL: keep the image
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      renderer.setPixelRatio(dpr);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement);
      renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%";

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.4;
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      camera.position.set(0, 0.05, 6.4);

      const P = (x: number, y: number, z: number) => new THREE.Vector3((x - 32) / 26, (31 - y) / 26, z);
      const D = 0.62, T = 0.2;
      const outline = [[32, 4], [55, 12], [55, 30], [32, 60], [9, 30], [9, 12]];
      const apex = P(32, 30, D), backC = P(32, 30, -T);
      const front = outline.map(([x, y]) => P(x, y, 0)), back = outline.map(([x, y]) => P(x, y, -T));
      const pos: number[] = [], groups: number[] = [];
      const tri = (a: import("three").Vector3, b: import("three").Vector3, c: import("three").Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      for (let i = 0; i < 6; i++) { tri(front[(i + 1) % 6], front[i], apex); groups.push(i); }
      for (let i = 0; i < 6; i++) { const a = front[i], b = front[(i + 1) % 6], c = back[(i + 1) % 6], d = back[i]; tri(a, c, d); tri(a, b, c); groups.push(6, 6); }
      for (let i = 0; i < 6; i++) { tri(back[i], back[(i + 1) % 6], backC); groups.push(7); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      groups.forEach((m, i) => geo.addGroup(i * 3, 3, m));
      const facet = ["#3355FF", "#1F3FE0", "#2A49F0", "#4A68FF", "#5C78FF", "#7C95FF"].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.05, flatShading: true, emissive: "#3355FF", emissiveIntensity: 0 }),
      );
      const side = new THREE.MeshStandardMaterial({ color: "#1A33C2", roughness: 0.6, flatShading: true });
      const mesh = new THREE.Mesh(geo, [...facet, side, side]);
      const group = new THREE.Group();
      group.add(mesh);
      scene.add(group);
      const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(-4, 5, 4); scene.add(key);
      const fill = new THREE.DirectionalLight(0xdfe6ff, 0.9); fill.position.set(5, -2, 3); scene.add(fill);
      const rim = new THREE.DirectionalLight(0xbfd0ff, 1.6); rim.position.set(3, 2, -4); scene.add(rim);
      scene.add(new THREE.AmbientLight(0xffffff, 0.35));

      const resize = () => {
        const r = el.getBoundingClientRect();
        renderer.setSize(r.width, r.height, false);
        camera.aspect = r.width / Math.max(1, r.height);
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);

      let tx = 0, ty = 0, cx = 0, cy = 0, visible = true, raf = 0, glow = 0;
      const onMove = (e: PointerEvent) => { tx = (e.clientX / window.innerWidth - 0.5) * 2; ty = (e.clientY / window.innerHeight - 0.5) * 2; };
      const onScan = () => { glow = 1; };
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("heimdall:scan", onScan);
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); });
      io.observe(el);
      const t0 = performance.now();
      const loop = () => {
        cancelAnimationFrame(raf);
        if (!visible) return;
        const t = (performance.now() - t0) / 1000;
        cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
        const scroll = Math.min(1, window.scrollY / window.innerHeight);
        group.rotation.y = -0.32 + Math.sin(t * 0.6) * 0.12 + cx * 0.35 + scroll * 0.9;
        group.rotation.x = 0.14 + Math.sin(t * 0.8) * 0.04 + cy * 0.2;
        group.position.y = Math.sin(t * 1.1) * 0.06 - scroll * 0.3;
        glow *= 0.95;
        facet.forEach((m, i) => { m.emissiveIntensity = glow * (0.25 + 0.1 * Math.sin(t * 8 + i)); });
        renderer.render(scene, camera);
        raf = requestAnimationFrame(loop);
      };
      loop();
      setReady(true);
      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
        window.removeEventListener("pointermove", onMove); window.removeEventListener("heimdall:scan", onScan);
        geo.dispose(); renderer.dispose(); renderer.domElement.remove();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, []);

  return (
    <div ref={host} className={`relative ${className}`} style={{ width: size, height: size, maxWidth: "100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-3d.webp" alt="" className={`absolute inset-0 m-auto h-[72%] w-auto transition-opacity duration-500 ${ready ? "opacity-0" : "opacity-100"}`} />
    </div>
  );
}
