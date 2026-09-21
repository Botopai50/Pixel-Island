import * as THREE from 'three';
import { InputManager } from './inputManager.ts';
import { ITerrainHeightQueryable } from './terrainRaycaster.ts';
import { CONFIG } from '../config.ts';

export class FirstPersonController {
  public camera: THREE.PerspectiveCamera;
  public position: THREE.Vector3 = new THREE.Vector3();
  private velocity: THREE.Vector3 = new THREE.Vector3();

  public yaw: number = 0;
  public pitch: number = 0;

  // Parâmetros de caminhada e corrida
  private walkSpeed: number = 6.5;
  private sprintSpeed: number = 13.0;
  private acceleration: number = 18.0;
  private damping: number = 9.0;
  private eyeHeight: number = 1.75;

  // Head bobbing sutil para imersão
  private bobTimer: number = 0;
  private currentBob: number = 0;

  // Mouse look
  private isMouseDragging: boolean = false;
  private prevMouseX: number = 0;
  private prevMouseY: number = 0;
  private lookSensitivity: number = 0.0026;

  constructor() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 2500);
    this.camera.rotation.order = 'YXZ';

    this.setupMouseListeners();
  }

  private setupMouseListeners(): void {
    // 1. Suporte a Pointer Lock (se o usuário clicar na tela)
    document.addEventListener('pointerlockchange', () => {
      // Estado de pointer lock atualizado
    });

    window.addEventListener('mousedown', (e) => {
      if (e.target instanceof HTMLButtonElement || (e.target as HTMLElement)?.closest?.('.hud-no-drag')) {
        return;
      }
      if (e.button === 0) {
        this.isMouseDragging = true;
        this.prevMouseX = e.clientX;
        this.prevMouseY = e.clientY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        // Modo Pointer Lock puro
        this.applyLookDelta(e.movementX, e.movementY);
      } else if (this.isMouseDragging) {
        // Modo Arrasto com o Botão Esquerdo
        const dx = e.clientX - this.prevMouseX;
        const dy = e.clientY - this.prevMouseY;
        this.prevMouseX = e.clientX;
        this.prevMouseY = e.clientY;
        this.applyLookDelta(dx, dy);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isMouseDragging = false;
      }
    });
  }

  public applyLookDelta(deltaX: number, deltaY: number): void {
    this.yaw -= deltaX * this.lookSensitivity;
    this.pitch -= deltaY * this.lookSensitivity;

    // Limita o pitch vertical para não virar a cabeça do avesso (~ -84° a +84°)
    const maxPitch = 1.46;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
  }

  public setPosition(x: number, z: number, terrain?: ITerrainHeightQueryable): void {
    this.position.x = x;
    this.position.z = z;
    const h = terrain ? terrain.getHeight(x, z) : 0;
    this.position.y = Math.max(h, CONFIG.SEA_LEVEL) + this.eyeHeight;
    this.velocity.set(0, 0, 0);
    this.camera.position.set(this.position.x, this.position.y, this.position.z);
  }

  public setLookDirection(targetYaw: number, targetPitch: number = 0): void {
    this.yaw = targetYaw;
    this.pitch = targetPitch;
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  public update(dt: number, input: InputManager, terrain: ITerrainHeightQueryable): void {
    // 1. Calcula direção de caminhada a partir do Yaw e vetor de entrada (analógico ou teclado)
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    const moveVec = input.getMovementVector();
    let moveDirX = forwardX * moveVec.y + rightX * moveVec.x;
    let moveDirZ = forwardZ * moveVec.y + rightZ * moveVec.x;

    const len = Math.hypot(moveDirX, moveDirZ);
    const inputMagnitude = Math.min(1.0, len);
    if (len > 0.0001) {
      moveDirX /= len;
      moveDirZ /= len;
    }

    // 2. Velocidade e Aceleração
    const isSprinting = input.isSprinting();
    const baseSpeed = isSprinting ? this.sprintSpeed : this.walkSpeed;
    const targetSpeed = len > 0 ? baseSpeed * inputMagnitude : 0;

    const targetVelX = moveDirX * targetSpeed;
    const targetVelZ = moveDirZ * targetSpeed;

    const blendFactor = Math.min(dt * (len > 0 ? this.acceleration : this.damping), 1.0);
    this.velocity.x += (targetVelX - this.velocity.x) * blendFactor;
    this.velocity.z += (targetVelZ - this.velocity.z) * blendFactor;

    // 3. Integração de posição horizontal com colisão de encostas íngremes (Anti-Penetração em Montanhas)
    const stepDx = this.velocity.x * dt;
    const stepDz = this.velocity.z * dt;
    const stepDist = Math.hypot(stepDx, stepDz);

    if (stepDist > 0.0001) {
      const currentH = terrain.getHeight(this.position.x, this.position.z);
      const probeDist = Math.max(stepDist, 0.45); // Sondagem antecipada à frente dos passos
      const dirX = stepDx / stepDist;
      const dirZ = stepDz / stepDist;
      const probeX = this.position.x + dirX * probeDist;
      const probeZ = this.position.z + dirZ * probeDist;
      const probeH = terrain.getHeight(probeX, probeZ);
      const deltaH = probeH - currentH;
      const slope = deltaH / probeDist;

      const MAX_WALKABLE_SLOPE = 0.85; // Inclinação máxima transponível a pé (~40°)

      if (slope > MAX_WALKABLE_SLOPE) {
        // Encosta muito íngreme ou despenhadeiro/paredão de montanha: impede atravessar a rocha
        // Calcula a normal horizontal do terreno (gradiente ascendente/descendente)
        const eps = 0.4;
        const hL = terrain.getHeight(this.position.x - eps, this.position.z);
        const hR = terrain.getHeight(this.position.x + eps, this.position.z);
        const hD = terrain.getHeight(this.position.x, this.position.z - eps);
        const hU = terrain.getHeight(this.position.x, this.position.z + eps);
        const gradX = (hR - hL) / (2 * eps);
        const gradZ = (hU - hD) / (2 * eps);
        const gradLen = Math.hypot(gradX, gradZ);

        if (gradLen > 0.001) {
          // Tangente à curva de nível da montanha (desliza lateralmente ao longo da encosta)
          const tangX = -gradZ / gradLen;
          const tangZ = gradX / gradLen;
          const dot = this.velocity.x * tangX + this.velocity.z * tangZ;
          this.velocity.x = tangX * dot * 0.65;
          this.velocity.z = tangZ * dot * 0.65;
        } else {
          this.velocity.x = 0;
          this.velocity.z = 0;
        }
      }
    }

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // 4. Acompanhamento do piso com garantia absoluta anti-penetração (Hard Ground Clamp)
    const terrainH = terrain.getHeight(this.position.x, this.position.z);
    const targetY = Math.max(terrainH, CONFIG.SEA_LEVEL - 0.3) + this.eyeHeight;

    // Se estiver abaixo do piso, sobe INSTANTANEAMENTE (elimina qualquer clipping sob o relevo)
    if (this.position.y < targetY) {
      this.position.y = targetY;
    } else {
      // Descida suave com gravidade natural
      this.position.y += (targetY - this.position.y) * Math.min(dt * 15.0, 1.0);
      if (this.position.y < targetY) {
        this.position.y = targetY;
      }
    }

    // 5. Head Bobbing cinemático
    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (currentSpeed > 0.5) {
      this.bobTimer += dt * (isSprinting ? 12.5 : 8.5);
      const bobTarget = Math.sin(this.bobTimer) * 0.045 * (currentSpeed / this.walkSpeed);
      this.currentBob += (bobTarget - this.currentBob) * Math.min(dt * 15.0, 1.0);
    } else {
      this.currentBob += (0 - this.currentBob) * Math.min(dt * 8.0, 1.0);
    }

    // 6. Atualiza câmera em primeira pessoa
    this.camera.position.set(
      this.position.x,
      this.position.y + this.currentBob,
      this.position.z
    );

    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  public onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
