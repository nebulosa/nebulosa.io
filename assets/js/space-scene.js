// Header illustrations in three.js. The page marks the illustration with
// <img data-scene>; the scene draws over that img, which keeps the layout box and
// stays as the fallback when WebGL or this module never arrives (the timer in
// _includes/scene-head.html). A page module supplies what is in the scene:
//
//   mountScene((THREE, kit) => ({ spin, tick(dt, elapsed), cameraZ, feather, stars }))
//
// `spin` is the object dragging turns; `tick` runs only when motion is allowed;
// `feather` fades the canvas edges, for scenes whose glow would otherwise be cut
// off in a hard rectangle; `stars: false` drops the canvas's own star field and
// comet, for scenes that should sit directly on the page's background.
import * as THREE from 'three';

// Illustration palette, Nebulosa Brand Guidelines v1.0 p.5-7.
export const palette = {
  navy: 0x000d22, blue: 0x002b56, violet: 0x4a257d, purple: 0x5c2684,
  lilac: 0x908cc3, periwinkle: 0x8585b9, wine: 0x890b3d, pink: 0xe94884,
  coral: 0xeb5c5f, salmon: 0xd77969, gold: 0xfab600, cream: 0xfff48c, mist: 0xe3e6e5,
};

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function fallback(reason) {
  console.warn('Header scene unavailable, keeping the SVG:', reason);
  document.documentElement.classList.add('scene-fallback');
}

// Soft round glow, shared by stars and beacons.
let glowTexture;
function glow(color, size, opacity = 1) {
  if (!glowTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    glowTexture = new THREE.CanvasTexture(c);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color, opacity, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sprite.scale.setScalar(size);
  return sprite;
}

// Background stars in two layers that twinkle out of phase.
function starField(scene) {
  const colors = [0xffffff, 0xffffff, palette.cream, palette.periwinkle, palette.salmon];
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dg = dot.getContext('2d');
  dg.fillStyle = '#fff'; dg.beginPath(); dg.arc(16, 16, 14, 0, Math.PI * 2); dg.fill();
  const map = new THREE.CanvasTexture(dot);

  const layer = (count, size) => {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      pos.set([(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6.5, -1.5 - Math.random() * 3], i * 3);
      c.setHex(colors[i % colors.length]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ size, map, alphaTest: 0.5, vertexColors: true, transparent: true }));
    scene.add(points);
    return points;
  };
  const a = layer(110, 0.07), b = layer(50, 0.11);
  return (t) => {
    a.material.opacity = 0.65 + Math.sin(t * 1.7) * 0.35;
    b.material.opacity = 0.65 + Math.sin(t * 1.3 + 2) * 0.35;
  };
}

// A comet that crosses now and then: gold head, fading tail.
function comet(scene) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.9, 0.9, 0]), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([0.98, 0.71, 0, 0.05, 0.03, 0.15]), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending }));
  line.visible = false;
  scene.add(line);
  return (t) => {
    const p = (t % 9) / 9; // one pass every 9 s, visible during the first 40%
    line.visible = p < 0.4;
    line.position.set(3.8 - p * 9, 2.4 - p * 9, -0.5);
  };
}

export function mountScene(build) {
  const img = document.querySelector('img[data-scene]');
  if (!img) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    fallback(e);
    return;
  }

  const canvas = renderer.domElement;
  canvas.className = 'space-scene';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', (img.getAttribute('alt') || 'Space illustration') + '; drag to spin');
  canvas.style.left = canvas.style.top = '0px';
  img.insertAdjacentElement('afterend', canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);

  // Lighting rig from the 3D symbol handoff, so every scene reads as one family.
  scene.add(new THREE.HemisphereLight(0xcfd6ff, 0x1a1030, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(0.9, 1.3, 1.1); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc59bff, 1.5); rim.position.set(-1.1, 0.5, -0.9); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x7f8dff, 0.9); fill.position.set(-0.6, -0.8, 0.9); scene.add(fill);

  const world = new THREE.Group();
  scene.add(world);

  const { spin, tick, cameraZ = 5.9, feather = false, stars = true } = build(THREE, { scene, world, glow, palette });
  const twinkle = stars ? starField(scene) : () => {};
  const cometTick = stars ? comet(scene) : () => {};
  canvas.classList.toggle('space-scene--feathered', feather);
  camera.position.set(0, 0, cameraZ);

  let visible = true, dirty = true;

  function fit() {
    if (!img.offsetWidth || !img.offsetHeight) return;
    // Pages shift and scale the img with their own rules (breakpoint offsets,
    // transform: scale on about-us), so match on-screen boxes: size first, then
    // position, each corrected by what the canvas actually measures.
    Object.assign(canvas.style, { width: img.offsetWidth + 'px', height: img.offsetHeight + 'px' });
    let a = img.getBoundingClientRect(), b = canvas.getBoundingClientRect();
    const w = img.offsetWidth * (a.width / b.width), h = img.offsetHeight * (a.height / b.height);
    Object.assign(canvas.style, { width: w + 'px', height: h + 'px' });
    a = img.getBoundingClientRect(); b = canvas.getBoundingClientRect();
    canvas.style.left = parseFloat(canvas.style.left) + a.left - b.left + 'px';
    canvas.style.top = parseFloat(canvas.style.top) + a.top - b.top + 'px';
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  // Drag numbers from the 3D symbol handoff: horizontal drag spins with momentum,
  // vertical drag tilts (clamped). The pointer anywhere adds a little parallax.
  let tx = 0, ty = 0, cx = 0, cy = 0;
  let dragging = false, lastX = 0, lastY = 0, vel = 0, tilt = 0;
  addEventListener('pointermove', (e) => {
    if (!dragging) {
      tx = (e.clientX / innerWidth - 0.5) * 0.25;
      ty = (e.clientY / innerHeight - 0.5) * 0.18;
      return;
    }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    vel = dx * 0.006;
    spin.rotation.y += vel;
    tilt = Math.min(1.1, Math.max(-0.2, tilt + dy * 0.004));
    dirty = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY; vel = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-dragging');
  });
  const release = () => { dragging = false; canvas.classList.remove('is-dragging'); };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(canvas);
  new ResizeObserver(fit).observe(img);
  addEventListener('resize', fit);
  fit();

  let last = performance.now(), elapsed = 0, shown = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!visible) return;

    // Motion the visitor causes (drag, momentum, parallax) always runs; the
    // page's own idle motion stops under prefers-reduced-motion.
    if (!dragging && Math.abs(vel) > 1e-4) { spin.rotation.y += vel; vel *= 0.94; dirty = true; }
    const px = cx, py = cy;
    cx += (tx - cx) * 0.05; cy += (ty - cy) * 0.05;
    if (Math.abs(cx - px) + Math.abs(cy - py) > 1e-5) dirty = true;
    world.rotation.set(cy + tilt * 0.35, cx, 0);

    if (!reduced) {
      elapsed += dt;
      tick(dt, elapsed);
      world.position.y = Math.sin(elapsed * 0.6) * 0.06;
      twinkle(elapsed);
      cometTick(elapsed);
      dirty = true;
    }

    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
    if (!shown) { shown = true; document.documentElement.classList.add('scene-ready'); }
  }
  requestAnimationFrame(frame);
}
