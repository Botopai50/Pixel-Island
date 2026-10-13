// @ts-nocheck
import * as THREE from 'three';

/** Turn around the authored stem axis; camera pitch and roll never change its tilt. */
export function faceCameraHorizontally(card: THREE.Mesh, camera: THREE.Camera, stemAxis = new THREE.Vector3(0, 1, 0)) {
  const desired = new THREE.Euler().setFromQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
  const parent = card.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  const up = stemAxis.clone().normalize().applyQuaternion(parent);
  const normal = new THREE.Vector3(Math.sin(desired.y), 0, Math.cos(desired.y));
  normal.addScaledVector(up, -normal.dot(up));
  // A nearly horizontal stem can align with the requested facing direction.
  if (normal.lengthSq() < 1e-10) {
    normal.set(Math.cos(desired.y), 0, -Math.sin(desired.y));
    normal.addScaledVector(up, -normal.dot(up));
  }
  normal.normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
  card.quaternion.copy(parent.invert().multiply(world));
  card.updateMatrixWorld(true);
}

export function createReedHeadResources(scale: number) {
  const width = 8, height = 32;
  const data = new Uint8Array(width * height * 4);
  const tones = ['#493321', '#68442c', '#885735', '#ae7949'].map(c => new THREE.Color(c));
  const put = (x: number, y: number, tone: number) => {
    const offset = (y * width + x) * 4, c = tones[tone];
    data[offset] = Math.round(c.r * 255); data[offset+1] = Math.round(c.g * 255);
    data[offset+2] = Math.round(c.b * 255); data[offset+3] = 255;
  };
  // Rounded stepped silhouette; highlights follow the length of the velvet head.
  for (let y = 4; y < 28; y++) {
    const inset = y === 4 || y === 27 ? 2 : y === 5 || y === 26 ? 1 : 0;
    for (let x = 1 + inset; x <= 6 - inset; x++) {
      const edge = x === 1 + inset || x === 6 - inset;
      const tone = edge ? 0 : x === 2 ? 3 : x <= 4 ? ((y % 7 === 2 && x === 4) ? 1 : 2) : 1;
      put(x, y, tone);
    }
  }
  for (let y = 28; y < 32; y++) put(3, y, 1);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  const geometry = new THREE.PlaneGeometry(.12 * scale, .48 * scale);
  geometry.setAttribute('aSway', new THREE.Float32BufferAttribute([.525,.525,.525,.525],1));
  return { geometry, texture };
}
