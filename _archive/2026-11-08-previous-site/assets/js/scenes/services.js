// Services header: a ringed planet with an orbiting moon.
import { mountScene } from '../space-scene.js';

mountScene((THREE, { world, palette }) => {
  // Surface drawn in the illustration palette. Uneven on purpose (mixed wave
  // periods, a storm, crater clusters) so the rotation reads.
  function planetTexture() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#e94884'); sky.addColorStop(0.5, '#5c2684');
    g.fillStyle = sky; g.fillRect(0, 0, 1024, 512);

    const wave = (base, amps, color, alpha) => {
      g.beginPath(); g.moveTo(0, 512);
      for (let x = 0; x <= 1024; x += 4) {
        const u = (x / 1024) * Math.PI * 2;
        g.lineTo(x, base + amps.reduce((y, [a, k, ph]) => y + a * Math.sin(u * k + ph), 0));
      }
      g.lineTo(1024, 512); g.closePath();
      g.globalAlpha = alpha; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    };
    const sea = g.createLinearGradient(0, 200, 0, 512);
    sea.addColorStop(0, '#ffffff'); sea.addColorStop(0.5, '#e3e6e5'); sea.addColorStop(1, '#908cc3');
    wave(255, [[34, 1, 0.4], [16, 3, 1.3], [7, 7, 2.1]], sea, 1);
    wave(340, [[22, 2, 2.2], [10, 5, 0.3]], '#908cc3', 0.35);

    g.fillStyle = '#e94884'; g.globalAlpha = 0.9;
    g.beginPath(); g.ellipse(700, 150, 58, 22, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#890b3d'; g.globalAlpha = 0.6;
    g.beginPath(); g.ellipse(706, 152, 30, 10, 0, 0, Math.PI * 2); g.fill();

    g.fillStyle = '#908cc3'; g.globalAlpha = 0.5;
    for (const [x, y, r] of [[110, 330, 22], [150, 380, 10], [80, 400, 7], [460, 420, 15], [520, 360, 8],
                             [820, 340, 18], [860, 400, 9], [300, 300, 6]]) {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  const spin = new THREE.Group();
  world.add(spin);
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshStandardMaterial({ map: planetTexture(), roughness: 0.55, metalness: 0.05 })
  );
  planet.rotation.z = 0.12;
  spin.add(planet);

  // Seen from above: the near side of the ring crosses the lower half.
  const system = new THREE.Group();
  system.rotation.set(-1.12, 0, -0.32);
  world.add(system);

  system.add(new THREE.Mesh(
    new THREE.RingGeometry(1.4, 1.6, 160),
    new THREE.MeshStandardMaterial({ color: 0x6e4aa8, emissive: 0x2a1450, roughness: 0.4, side: THREE.DoubleSide })
  ));

  const moonOrbit = new THREE.Group();
  system.add(moonOrbit);
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 32, 24),
    new THREE.MeshStandardMaterial({ color: palette.pink, emissive: palette.violet, emissiveIntensity: 0.35, roughness: 0.45 })
  );
  moon.position.set(1.85, 0, 0);
  moonOrbit.add(moon);

  return {
    spin,
    tick(dt, t) {
      spin.rotation.y += dt * 0.25;
      moonOrbit.rotation.z = t * 0.35;
    },
  };
});
