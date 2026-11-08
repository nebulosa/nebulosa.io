/**
 * nebulosa-symbol.js — the Nebulosa mark as 3D geometry.
 *
 * Pure geometry + materials, no renderer: `buildSymbol(THREE)` returns a
 * THREE.Group of named meshes (12 creased facets + core). `mountSymbol()`
 * is the drop-in hero widget: transparent background, slow turntable,
 * cursor parallax, drag to spin.
 *
 * Requires three@0.184.0 available as the bare specifier "three"
 * (import map) or pass your own THREE into buildSymbol().
 */

export const PALETTE = {
  violeta_profundo: 0x4b2470,
  magenta: 0x9c3b8e,
  azul_periwinkle: 0x6a79c2,
  violeta_medio: 0x6e3b96,
  nucleo: 0xe9e7f2
};

export const DEFAULTS = {
  edge: 0.30,    // tetrahedron edge, meters
  thick: 0.016,  // facet plate thickness
  inset: 0.972,  // facet shrink -> width of the light gaps (lower = wider gaps)
  peak: 0.018    // how far each face centre lifts -> crease depth
};

export function buildSymbol(THREE, opts = {}) {
  const { edge, thick, inset, peak } = { ...DEFAULTS, ...opts };

  const mats = [
    new THREE.MeshStandardMaterial({ name: 'violeta_profundo', color: PALETTE.violeta_profundo, roughness: 0.28, metalness: 0.24 }),
    new THREE.MeshStandardMaterial({ name: 'magenta', color: PALETTE.magenta, roughness: 0.26, metalness: 0.24 }),
    new THREE.MeshStandardMaterial({ name: 'azul_periwinkle', color: PALETTE.azul_periwinkle, roughness: 0.26, metalness: 0.24 }),
    new THREE.MeshStandardMaterial({ name: 'violeta_medio', color: PALETTE.violeta_medio, roughness: 0.30, metalness: 0.24 })
  ];

  const s = edge / (2 * Math.SQRT2);
  let verts = [
    new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(-1, 1, -1), new THREE.Vector3(-1, -1, 1)
  ].map(v => v.multiplyScalar(s));

  // stand it on the face opposite vertex 0
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0));
  verts = verts.map(v => v.clone().applyQuaternion(q));

  const group = new THREE.Group();
  group.name = 'nebulosa_symbol';
  const centroid = verts.reduce((a, v) => a.add(v.clone()), new THREE.Vector3()).multiplyScalar(0.25);

  function plate(pts, mat, name) {
    const c = pts.reduce((a, v) => a.add(v.clone()), new THREE.Vector3()).multiplyScalar(1 / 3);
    const tri = pts.map(v => v.clone().sub(c).multiplyScalar(inset).add(c));

    let n = new THREE.Vector3().subVectors(tri[1], tri[0])
      .cross(new THREE.Vector3().subVectors(tri[2], tri[0])).normalize();
    if (n.dot(new THREE.Vector3().subVectors(c, centroid)) < 0) n.negate();

    const u = new THREE.Vector3().subVectors(tri[1], tri[0]).normalize();
    const w = new THREE.Vector3().crossVectors(n, u).normalize();

    const shape = new THREE.Shape(tri.map(v => {
      const d = v.clone().sub(c);
      return new THREE.Vector2(d.dot(u), d.dot(w));
    }));

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thick, bevelEnabled: true, bevelThickness: 0.0014, bevelSize: 0.0014, bevelSegments: 2
    });
    geo.translate(0, 0, -thick);
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(u, w, n).setPosition(c));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    group.add(mesh);
  }

  const faces = [[1, 2, 3], [0, 3, 2], [0, 1, 3], [0, 2, 1]];
  const names = ['base', 'a', 'b', 'c'];
  faces.forEach((f, i) => {
    const p = f.map(k => verts[k]);
    const fc = p.reduce((a, v) => a.add(v.clone()), new THREE.Vector3()).multiplyScalar(1 / 3);
    const fn = new THREE.Vector3().subVectors(p[1], p[0])
      .cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
    if (fn.dot(new THREE.Vector3().subVectors(fc, centroid)) < 0) fn.negate();
    const apex = fc.clone().add(fn.clone().multiplyScalar(peak));
    for (let k = 0; k < 3; k++) {
      plate([p[k], p[(k + 1) % 3], apex], mats[(i + k) % mats.length], 'facet_' + names[i] + (k + 1));
    }
  });

  const core = new THREE.Mesh(
    new THREE.TetrahedronGeometry(edge * 0.17, 0),
    new THREE.MeshStandardMaterial({ name: 'nucleo', color: PALETTE.nucleo, roughness: 0.5, metalness: 0.05 })
  );
  core.name = 'core';
  core.position.copy(centroid);
  group.add(core);

  group.userData.centroid = centroid;
  return group;
}

/**
 * mountSymbol(hostEl, { THREE, tiltBase, spin })
 * Fills hostEl with a transparent-background animated symbol.
 * Returns { dispose() }.
 */
export async function mountSymbol(host, opts = {}) {
  const THREE = opts.THREE || await import('three');
  const tiltBase = opts.tiltBase ?? 0.52;
  const spin = opts.spin ?? 0.0016;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0.20, 0.30, 0.56);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xcfd6ff, 0x1a1030, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(0.9, 1.3, 1.1); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc59bff, 1.5); rim.position.set(-1.1, 0.5, -0.9); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x7f8dff, 0.9); fill.position.set(-0.6, -0.8, 0.9); scene.add(fill);

  const model = buildSymbol(THREE, opts);
  const pivot = new THREE.Group();
  model.position.sub(model.userData.centroid);
  pivot.add(model);
  scene.add(pivot);

  let targetX = tiltBase, targetY = 0, curX = tiltBase, curY = 0;
  let dragging = false, lastX = 0, lastY = 0, vel = 0, alive = true;

  host.style.cursor = 'grab';
  const onDown = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; host.style.cursor = 'grabbing'; host.setPointerCapture(e.pointerId); };
  const onUp = e => { dragging = false; host.style.cursor = 'grab'; host.releasePointerCapture(e.pointerId); };
  const onDrag = e => {
    if (!dragging) return;
    vel = (e.clientX - lastX) * 0.006;
    pivot.rotation.y += vel;
    targetX = Math.max(-0.2, Math.min(1.1, targetX + (e.clientY - lastY) * 0.004));
    lastX = e.clientX; lastY = e.clientY;
  };
  const onHover = e => {
    if (dragging) return;
    const r = host.getBoundingClientRect();
    targetY = ((e.clientX - (r.left + r.width / 2)) / window.innerWidth) * 0.5;
    targetX = tiltBase + ((e.clientY - (r.top + r.height / 2)) / window.innerHeight) * -0.35;
  };
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointermove', onDrag);
  window.addEventListener('pointermove', onHover);

  function resize() {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  (function loop() {
    if (!alive) return;
    requestAnimationFrame(loop);
    if (!dragging) { vel *= 0.94; pivot.rotation.y += spin + vel; }
    curX += (targetX - curX) * 0.05;
    curY += (targetY - curY) * 0.05;
    pivot.rotation.x = curX;
    pivot.rotation.z = curY * 0.35;
    renderer.render(scene, camera);
  })();

  return {
    dispose() {
      alive = false;
      ro.disconnect();
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointermove', onDrag);
      window.removeEventListener('pointermove', onHover);
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
