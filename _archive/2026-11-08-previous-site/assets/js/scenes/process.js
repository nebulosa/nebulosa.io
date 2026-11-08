// Process header: three satellites on inclined orbits around a planet, handing
// data to each other along beams of light.
import { mountScene } from '../space-scene.js';

mountScene((THREE, { world, glow, palette }) => {
  const green = 0x1fab84; // website palette, Brand Guidelines v1.0 p.4

  const tilt = new THREE.Group();
  tilt.rotation.x = 0.25;
  world.add(tilt);
  const spin = new THREE.Group();
  tilt.add(spin);

  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 512;
  const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#908cc3'); sky.addColorStop(0.5, '#5c2684'); sky.addColorStop(1, '#002b56');
  g.fillStyle = sky; g.fillRect(0, 0, 1024, 512);
  g.globalAlpha = 0.4;
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = i % 2 ? '#e3e6e5' : '#e94884'; g.lineWidth = 10 - i;
    g.beginPath();
    for (let x = 0; x <= 1024; x += 8) {
      const y = 90 + i * 60 + Math.sin((x / 1024) * Math.PI * 2 * (i % 3 + 1) + i) * 12;
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(0.85, 64, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  spin.add(planet);
  spin.add(glow(palette.lilac, 3.0, 0.22));

  const panelMat = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const p = c.getContext('2d');
    p.fillStyle = '#8585b9'; p.fillRect(0, 0, 128, 64);
    p.strokeStyle = '#002b56'; p.lineWidth = 3;
    for (let x = 0; x <= 128; x += 16) { p.beginPath(); p.moveTo(x, 0); p.lineTo(x, 64); p.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, metalness: 0.4, roughness: 0.35 });
  })();
  const foil = new THREE.MeshStandardMaterial({ color: palette.gold, metalness: 0.8, roughness: 0.3, emissive: 0x3a2600 });
  function satellite() {
    const s = new THREE.Group();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.16), foil));
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.3, 0.13), panelMat);
      panel.position.y = side * 0.22;
      s.add(panel);
    }
    const light = glow(green, 0.3, 0.9);
    light.position.z = 0.1;
    s.add(light);
    s.scale.setScalar(1.3);
    return s;
  }

  const orbits = [
    { r: 1.55, incline: [0.35, 0, 0.2], speed: 0.45, phase: 0 },
    { r: 1.8, incline: [-0.3, 0, -0.35], speed: 0.33, phase: 2.1 },
    { r: 2.05, incline: [0.1, 0, 0.55], speed: 0.26, phase: 4.2 },
  ].map((o) => {
    const plane = new THREE.Group();
    plane.rotation.set(...o.incline);
    spin.add(plane);
    const pts = Array.from({ length: 129 }, (_, i) => {
      const a = (i / 128) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * o.r, 0, Math.sin(a) * o.r);
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: palette.periwinkle, dashSize: 0.06, gapSize: 0.08, transparent: true, opacity: 0.45 }));
    line.computeLineDistances();
    plane.add(line);
    const sat = satellite();
    plane.add(sat);
    return { ...o, plane, sat };
  });

  // Beams between consecutive satellites, each carrying a travelling spark.
  const beams = orbits.map(() => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: green, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }));
    spin.add(line);
    const spark = glow(palette.cream, 0.22, 1);
    spin.add(spark);
    return { geo, spark };
  });

  const a = new THREE.Vector3(), b = new THREE.Vector3(), center = new THREE.Vector3();
  function place(t) {
    for (const o of orbits) {
      const angle = o.phase + t * o.speed;
      o.sat.position.set(Math.cos(angle) * o.r, 0, Math.sin(angle) * o.r);
    }
    spin.updateMatrixWorld(true);
    spin.getWorldPosition(center);
    for (const o of orbits) o.sat.lookAt(center);
    beams.forEach((beam, i) => {
      orbits[i].sat.getWorldPosition(a); spin.worldToLocal(a);
      orbits[(i + 1) % orbits.length].sat.getWorldPosition(b); spin.worldToLocal(b);
      beam.geo.setFromPoints([a, b]);
      beam.spark.position.copy(a).lerp(b, (t * 0.5 + i / beams.length) % 1);
    });
  }
  place(3);

  return {
    spin,
    cameraZ: 6.4,
    tick(dt, t) {
      planet.rotation.y += dt * 0.12;
      place(t + 3);
    },
  };
});
