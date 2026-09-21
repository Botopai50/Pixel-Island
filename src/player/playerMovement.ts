import * as THREE from 'three';
import { CONFIG } from '../config.ts';
import { InputManager } from './inputManager.ts';

export class PlayerMovement {
  public position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private velocity: THREE.Vector2 = new THREE.Vector2(0, 0);

  public update(
    dt: number,
    input: InputManager,
    yaw: number,
    frustumSize: number
  ): void {
    // 1. Velocidade dinâmica adaptada estritamente à aproximação (zoom)
    const zoomRatio = frustumSize / CONFIG.CAMERA.DEFAULT_FRUSTUM_SIZE;
    const currentSpeed = CONFIG.CAMERA.BASE_MOVE_SPEED * Math.pow(zoomRatio, 0.95);

    // 2. Projeção dos eixos da visão no plano XZ
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const inputDir = new THREE.Vector2(0, 0);

    if (input.isMovingForward()) {
      inputDir.x += forwardX;
      inputDir.y += forwardZ;
    }
    if (input.isMovingBackward()) {
      inputDir.x -= forwardX;
      inputDir.y -= forwardZ;
    }
    if (input.isMovingLeft()) {
      inputDir.x -= rightX;
      inputDir.y -= rightZ;
    }
    if (input.isMovingRight()) {
      inputDir.x += rightX;
      inputDir.y += rightZ;
    }

    // 3. Aceleração inercial
    if (inputDir.lengthSq() > 0) {
      inputDir.normalize();
      this.velocity.x += inputDir.x * currentSpeed * CONFIG.CAMERA.ACCELERATION * dt;
      this.velocity.y += inputDir.y * currentSpeed * CONFIG.CAMERA.ACCELERATION * dt;
    }

    // Limite de velocidade momentânea
    const maxV = currentSpeed * 1.5;
    if (this.velocity.length() > maxV) {
      this.velocity.normalize().multiplyScalar(maxV);
    }

    // 4. Amortecimento inercial exponencial
    const damping = Math.exp(-CONFIG.CAMERA.DAMPING * dt);
    this.velocity.multiplyScalar(damping);

    // 5. Integração contínua da posição
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.y * dt;

    // 6. Pan via arrasto do mouse (botão do meio ou esquerdo)
    const drag = input.consumePanDelta();
    if (drag.x !== 0 || drag.y !== 0) {
      const panFactor = (frustumSize / window.innerHeight) * 1.1;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);

      const moveX = (-drag.x * cosY - drag.y * sinY) * panFactor;
      const moveZ = (drag.x * sinY - drag.y * cosY) * panFactor;

      this.position.x += moveX;
      this.position.z += moveZ;
    }
  }

  public setPosition(x: number, z: number): void {
    this.position.x = x;
    this.position.z = z;
    this.velocity.set(0, 0);
  }
}
