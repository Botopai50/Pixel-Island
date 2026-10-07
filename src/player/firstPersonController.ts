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

  // Parâmetros de caminhada e corrida (valores de um humano de 1.75m, escalados por PLAYER_SCALE)
  private scale: number = CONFIG.PLAYER_SCALE;
  private walkSpeed: number = 6.5 * CONFIG.PLAYER_SCALE;
  private sprintSpeed: number = 13.0 * CONFIG.PLAYER_SCALE;
  private acceleration: number = 18.0;
  private damping: number = 9.0;
  public eyeHeight: number = 1.75 * CONFIG.PLAYER_SCALE;

  /** Multiplicador da velocidade (lama e água quente < 1); quem define é o ambiente, a cada quadro */
  public speedMul: number = 1;
  /** Piso mínimo (m): numa poça funda o personagem boia na superfície em vez de andar no fundo */
  public minFloor: number = -1e9;
  // Voo (gêiser): altura acima do piso e velocidade vertical
  private airH: number = 0;
  private airV: number = 0;

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
    // alcance de 14km: o terreno do horizonte vai até ~12km
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.2 * CONFIG.PLAYER_SCALE, 14000);
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

  /**
   * Muda o tamanho do personagem em tempo real (1 = humano de 1.75m): altura dos olhos,
   * velocidades, balanço e sondagens escalam juntos. Mantém os pés no mesmo lugar.
   */
  public setScale(scale: number): void {
    const feetY = this.position.y - this.eyeHeight;
    this.scale = scale;
    this.walkSpeed = 6.5 * scale;
    this.sprintSpeed = 13.0 * scale;
    this.eyeHeight = 1.75 * scale;
    this.position.y = feetY + this.eyeHeight;
    this.camera.near = 0.2 * scale; // 0.2 (não 0.1): com o alcance de 14km, mais precisão de profundidade
    this.camera.updateProjectionMatrix();
  }

  /** Empurrão horizontal (m/s), somado à velocidade atual. */
  public addVelocity(vx: number, vz: number): void {
    this.velocity.x += vx;
    this.velocity.z += vz;
  }

  /** Lança o personagem para cima (m/s): ele sobe, desacelera e cai. */
  public launch(vy: number): void {
    this.airV = vy;
    this.airH = Math.max(this.airH, 0.01);
  }

  public setPosition(x: number, z: number, terrain?: ITerrainHeightQueryable): void {
    this.position.x = x;
    this.position.z = z;
    const h = terrain ? terrain.getHeight(x, z) : 0;
    this.position.y = Math.max(h, terrain?.getWaterSurfaceY?.(x,z)??CONFIG.SEA_LEVEL) + this.eyeHeight;
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

    // pulo: só com os pés no chão (ou na água)
    if (this.airH <= 0 && input.consumeJump()) this.launch(6.5 * Math.sqrt(this.scale));

    // 2. Velocidade e Aceleração
    const isSprinting = input.isSprinting();
    const baseSpeed = (isSprinting ? this.sprintSpeed : this.walkSpeed) * this.speedMul;
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
      const probeDist = Math.max(stepDist, 0.45 * this.scale); // Sondagem antecipada à frente dos passos
      const dirX = stepDx / stepDist;
      const dirZ = stepDz / stepDist;
      const probeX = this.position.x + dirX * probeDist;
      const probeZ = this.position.z + dirZ * probeDist;
      const probeH = terrain.getHeight(probeX, probeZ);
      const deltaH = probeH - currentH;
      const slope = deltaH / probeDist;

      const MAX_WALKABLE_SLOPE = 0.85; // Inclinação máxima transponível a pé (~40°)

      // degrau baixo (barranco, quina da malha, borda de pedra) o personagem sobe andando: só uma subida
      // alta E íngreme bloqueia (antes qualquer degrau de ~0,5 m já passava de 40° na sondagem curta e
      // o personagem ficava "enganchado" em quinas e margens)
      const STEP_UP = 0.6 * this.scale;
      if (slope > MAX_WALKABLE_SLOPE && deltaH > STEP_UP) {
        // paredão ou encosta íngreme: tira da velocidade só a parte que vai de encontro à subida e
        // mantém o resto (desliza ao longo da parede, sem perder a velocidade nem ficar preso)
        const eps = 0.4 * this.scale;
        const hL = terrain.getHeight(probeX - eps, probeZ);
        const hR = terrain.getHeight(probeX + eps, probeZ);
        const hD = terrain.getHeight(probeX, probeZ - eps);
        const hU = terrain.getHeight(probeX, probeZ + eps);
        const gradX = (hR - hL) / (2 * eps);
        const gradZ = (hU - hD) / (2 * eps);
        const gradLen = Math.hypot(gradX, gradZ);

        if (gradLen > 0.001) {
          const nx = gradX / gradLen, nz = gradZ / gradLen;     // para onde o terreno sobe
          const into = this.velocity.x * nx + this.velocity.z * nz;
          if (into > 0) {
            this.velocity.x -= nx * into;
            this.velocity.z -= nz * into;
          }
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
    // voo: sobe com a velocidade do impulso e cai com a gravidade até pousar
    if (this.airH > 0 || this.airV !== 0) {
      this.airV -= 18.0 * dt;
      this.airH += this.airV * dt;
      if (this.airH <= 0) { this.airH = 0; this.airV = 0; }
    }
    const waterY = terrain.getWaterSurfaceY?.(this.position.x, this.position.z) ?? CONFIG.SEA_LEVEL;
    const targetY = Math.max(terrainH, waterY - 0.3, this.minFloor) + this.eyeHeight + this.airH;

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
    if (currentSpeed > 0.5 * this.scale) {
      this.bobTimer += dt * (isSprinting ? 12.5 : 8.5);
      const bobTarget = Math.sin(this.bobTimer) * 0.045 * this.scale * (currentSpeed / this.walkSpeed);
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
