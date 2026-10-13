// @ts-nocheck
import * as THREE from 'three';

/** Camera yaw remains free. Only extra penetration caused by pitch is limited. */
export function limitMushroomPitch(card: THREE.Mesh, normal: THREE.Vector3, width: number,
  points: THREE.Vector3[], clearance: number, pixelWidth: number) {
  const tolerance = 0;
  let safePitch = 0;
  card.userData.collisionPoints = points;
  card.userData.contactTolerance = tolerance;
  card.userData.collisionNormal = normal.clone();
  card.userData.collisionClearance = clearance;
  card.onBeforeRender = (_renderer, _scene, camera) => {
    const parent = card.parent!.getWorldQuaternion(new THREE.Quaternion());
    const worldNormal = normal.clone().applyQuaternion(parent);
    const desired = new THREE.Euler().setFromQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    const orientation = (pitch: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, desired.y, desired.z, 'YXZ'));
    const baselineNormal = worldNormal.clone().applyQuaternion(orientation(0).invert());
    // Sideways rotation may overlap the surface, as requested. Do not let that
    // pre-existing overlap freeze yaw or count as additional pitch penetration.
    const limits = points.map(p => Math.min(-tolerance, width * p.dot(baselineNormal) + clearance));
    const isClear = (pitch: number) => {
      const localNormal = worldNormal.clone().applyQuaternion(orientation(pitch).invert());
      return points.every((p, i) => width * p.dot(localNormal) + clearance >= limits[i] - 0.000001);
    };
    if (isClear(desired.x)) safePitch = desired.x;
    else {
      const start = isClear(safePitch) ? safePitch : 0;
      let low = 0, high = 1;
      for (let step = 0; step < 12; step++) {
        const fraction = (low + high) / 2;
        if (isClear(THREE.MathUtils.lerp(start, desired.x, fraction))) low = fraction;
        else high = fraction;
      }
      safePitch = THREE.MathUtils.lerp(start, desired.x, low);
    }
    card.quaternion.copy(parent.invert().multiply(orientation(safePitch)));
    card.updateMatrixWorld(true);
  };
}

/** Keep the original authored pixels and anchor while replacing a billboard sprite. */
export function treeMushroomCard(texture: THREE.Texture, width: number, anchor: THREE.Vector2,
  at: THREE.Vector3, normal: THREE.Vector3, lift = 0.008) {
  const image = texture.image as { width: number; height: number };
  const height = image.height / image.width;
  const geometry = new THREE.PlaneGeometry(1, height);
  geometry.translate(0.5 - anchor.x, height * (0.5 - anchor.y), 0);
  const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
  const card = new THREE.Mesh(geometry, material);
  card.name = 'TreeMushroom'; card.scale.setScalar(width);
  card.userData.excludeFromOBJ = true;
  card.position.copy(normal).normalize().multiplyScalar(lift);
  const mask = texture.userData.capMask as Uint8Array;
  const points: THREE.Vector3[] = [];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (!mask[y * image.width + x]) continue;
    for (const dx of [0, 1]) for (const dy of [0, 1]) points.push(new THREE.Vector3(
      (x + dx) / image.width - anchor.x, ((y + dy) / image.height - anchor.y) * height, 0));
  }
  const holder = new THREE.Group(); holder.name = 'TreeMushroomAnchor'; holder.position.copy(at); holder.add(card);
  limitMushroomPitch(card, normal.clone().normalize(), width, points, lift, image.width);
  return { holder, geometry, material };
}
