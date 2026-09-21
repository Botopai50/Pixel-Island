import * as THREE from 'three';
import { CONFIG } from '../config.ts';

export class ObserverCamera {
  public camera: THREE.OrthographicCamera;
  private frustumSize: number = CONFIG.CAMERA.DEFAULT_FRUSTUM_SIZE;
  private targetFrustumSize: number = CONFIG.CAMERA.DEFAULT_FRUSTUM_SIZE;

  public pitch: number = CONFIG.CAMERA.DEFAULT_PITCH;
  public yaw: number = CONFIG.CAMERA.DEFAULT_YAW;
  private targetYaw: number = CONFIG.CAMERA.DEFAULT_YAW;
  private viewDistance: number = 800.0;

  constructor(aspect: number) {
    this.camera = new THREE.OrthographicCamera(
      (-this.frustumSize * aspect) / 2,
      (this.frustumSize * aspect) / 2,
      this.frustumSize / 2,
      -this.frustumSize / 2,
      10,
      3500
    );
  }

  public applyWheelZoom(wheelDelta: number): void {
    if (wheelDelta === 0) return;
    const zoomFactor = Math.exp(wheelDelta * 0.0014);
    this.targetFrustumSize = Math.max(
      CONFIG.CAMERA.MIN_FRUSTUM_SIZE,
      Math.min(CONFIG.CAMERA.MAX_FRUSTUM_SIZE, this.targetFrustumSize * zoomFactor)
    );
  }

  // Gira a câmera horizontalmente (em torno do eixo Y), mantendo o pitch/ângulo de elevação estritamente fixo
  public applyRotation(deltaX: number): void {
    if (deltaX === 0) return;
    this.targetYaw -= deltaX * CONFIG.CAMERA.ROTATION_SENSITIVITY;
  }

  public update(dt: number, targetPosition: THREE.Vector3): void {
    if (Math.abs(this.frustumSize - this.targetFrustumSize) > 0.01) {
      this.frustumSize += (this.targetFrustumSize - this.frustumSize) * Math.min(dt * 9.0, 1.0);
      this.updateProjection();
    }

    // Adapta a distância de recuo da câmera ortográfica ao zoom para visão continental desimpedida
    this.viewDistance = Math.max(800.0, this.frustumSize * 1.15);

    // Suavização fluida de rotação horizontal (yaw)
    const yawDiff = this.targetYaw - this.yaw;
    if (Math.abs(yawDiff) > 0.0001) {
      this.yaw += yawDiff * Math.min(dt * 14.0, 1.0);
    }

    const sinP = Math.sin(this.pitch);
    const cosP = Math.cos(this.pitch);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    this.camera.position.set(
      targetPosition.x + this.viewDistance * sinY * cosP,
      targetPosition.y + this.viewDistance * sinP,
      targetPosition.z + this.viewDistance * cosY * cosP
    );

    this.camera.lookAt(targetPosition);
  }

  public updateProjection(): void {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.left = (-this.frustumSize * aspect) / 2;
    this.camera.right = (this.frustumSize * aspect) / 2;
    this.camera.top = this.frustumSize / 2;
    this.camera.bottom = -this.frustumSize / 2;
    this.camera.updateProjectionMatrix();
  }

  public getFrustumSize(): number {
    return this.frustumSize;
  }

  public getViewDistance(): number {
    return this.viewDistance;
  }

  public getPitch(): number {
    return this.pitch;
  }

  public getYaw(): number {
    return this.yaw;
  }
}
