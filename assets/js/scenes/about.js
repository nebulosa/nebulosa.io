// About header: the Nebulosa 3D symbol from the design handoff, alone on the
// page's own starry background. No stars, dust or glow of its own: anything
// behind the mark read as a patch of different background.
import { mountScene } from '../space-scene.js';
import { buildSymbol } from '../nebulosa-symbol.js';

mountScene((THREE, { world }) => {
  // The mark, unchanged from the handoff, scaled from meters to scene units and
  // centred on its own centroid. Base tilt 0.52 rad is the handoff's.
  const SCALE = 7;
  const symbol = buildSymbol(THREE);
  symbol.scale.setScalar(SCALE);
  symbol.position.copy(symbol.userData.centroid).multiplyScalar(-SCALE);
  const spin = new THREE.Group();
  spin.add(symbol);
  const stand = new THREE.Group();
  stand.rotation.x = 0.52;
  stand.add(spin);
  world.add(stand);

  return {
    spin,
    cameraZ: 5.0,
    stars: false,
    tick(dt) {
      spin.rotation.y += dt * 0.096; // the handoff's idle turntable, 0.0016 rad per 60 fps frame
    },
  };
});
