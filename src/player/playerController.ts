import * as THREE from 'three';
import { InputManager } from './inputManager.ts';
import { PlayerMovement } from './playerMovement.ts';
import { ObserverCamera } from './observerCamera.ts';
import { FirstPersonController } from './firstPersonController.ts';
import { ITerrainHeightQueryable } from './terrainRaycaster.ts';
import { CONFIG } from '../config.ts';

export enum CameraMode {
  OBSERVER = 'OBSERVER',
  FIRST_PERSON = 'FIRST_PERSON',
  TRANSITION_IN = 'TRANSITION_IN',
  TRANSITION_OUT = 'TRANSITION_OUT'
}

/**
 * PlayerController: Gerenciador unificado dos modos de câmera e exploração.
 * Suporta o modo aéreo contemplativo (Observer) e o modo solo imersivo (First Person),
 * além de transições cinemáticas fluidas no estilo Google Maps Pegman.
 */
export class PlayerController {
  private input: InputManager;
  private movement: PlayerMovement;
  private observerCamera: ObserverCamera;
  private firstPersonController: FirstPersonController;
  private transitionCamera: THREE.PerspectiveCamera;

  private mode: CameraMode = CameraMode.OBSERVER;
  private transitionTimer: number = 0;
  private transitionDuration: number = 1.35;

  // Pontos de interpolação cinemática
  private startPos: THREE.Vector3 = new THREE.Vector3();
  private targetPos: THREE.Vector3 = new THREE.Vector3();
  private startLookAt: THREE.Vector3 = new THREE.Vector3();
  private targetLookAt: THREE.Vector3 = new THREE.Vector3();
  private curLookAt: THREE.Vector3 = new THREE.Vector3();
  private startFov: number = 45;
  private targetFov: number = 75;

  private targetYaw: number = 0;
  private targetPitch: number = 0;

  // Callbacks para sincronização com a UI/HUD
  public onModeChange?: (mode: CameraMode) => void;

  constructor(aspect: number) {
    this.input = new InputManager();
    this.movement = new PlayerMovement();
    this.observerCamera = new ObserverCamera(aspect);
    this.firstPersonController = new FirstPersonController();
    this.transitionCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2500);

    // Listener global para a tecla ESC sair da primeira pessoa
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode === CameraMode.FIRST_PERSON) {
        this.transitionToObserver();
      }
    });
  }

  public getMode(): CameraMode {
    return this.mode;
  }

  public isFirstPerson(): boolean {
    return this.mode === CameraMode.FIRST_PERSON;
  }

  public isTransitioning(): boolean {
    return this.mode === CameraMode.TRANSITION_IN || this.mode === CameraMode.TRANSITION_OUT;
  }

  /**
   * Inicia o mergulho cinemático do Pegman em direção ao ponto de aterrissagem selecionado.
   */
  public transitionToFirstPerson(targetX: number, targetZ: number, terrain: ITerrainHeightQueryable): void {
    if (this.mode !== CameraMode.OBSERVER) return;

    this.mode = CameraMode.TRANSITION_IN;
    this.transitionTimer = 0;
    this.transitionDuration = 1.35;

    // Ponto inicial: onde a câmera aérea de observação se encontra no momento
    this.startPos.copy(this.observerCamera.camera.position);
    this.startLookAt.copy(this.movement.position);

    // Ponto final: altura dos olhos do jogador sobre o relevo da ilha
    const groundH = Math.max(terrain.getHeight(targetX, targetZ), CONFIG.SEA_LEVEL);
    const eyeY = groundH + 1.75;
    this.targetPos.set(targetX, eyeY, targetZ);

    // Direção inicial do olhar em 1ª pessoa: olha suavemente para a frente / interior da ilha
    const angleFromCenter = Math.atan2(targetX, targetZ);
    this.targetYaw = angleFromCenter + Math.PI * 0.75;
    this.targetPitch = -0.05; // Leve olhar no horizonte

    const forwardX = -Math.sin(this.targetYaw);
    const forwardZ = -Math.cos(this.targetYaw);
    this.targetLookAt.set(targetX + forwardX * 15.0, eyeY, targetZ + forwardZ * 15.0);

    this.startFov = 45;
    this.targetFov = 75;

    this.transitionCamera.fov = this.startFov;
    this.transitionCamera.position.copy(this.startPos);
    this.transitionCamera.lookAt(this.startLookAt);
    this.transitionCamera.updateProjectionMatrix();

    this.onModeChange?.(this.mode);
  }

  /**
   * Teleporte direto para primeira pessoa (útil para inicialização direta, scripts e resets).
   */
  public teleportToFirstPerson(targetX: number, targetZ: number, terrain: ITerrainHeightQueryable, yaw?: number, pitch?: number): void {
    this.mode = CameraMode.FIRST_PERSON;
    this.firstPersonController.setPosition(targetX, targetZ, terrain);
    if (yaw !== undefined) {
      this.firstPersonController.setLookDirection(yaw, pitch ?? 0);
    }
    this.onModeChange?.(this.mode);
  }

  /**
   * Inicia a ascensão cinemática da primeira pessoa de volta para a visão panorâmica aérea.
   */
  public transitionToObserver(): void {
    if (this.mode !== CameraMode.FIRST_PERSON) return;

    this.mode = CameraMode.TRANSITION_OUT;
    this.transitionTimer = 0;
    this.transitionDuration = 1.15;

    // Ponto inicial: posição atual do jogador em primeira pessoa
    this.startPos.copy(this.firstPersonController.camera.position);
    const forwardX = -Math.sin(this.firstPersonController.yaw);
    const forwardZ = -Math.cos(this.firstPersonController.yaw);
    this.startLookAt.set(
      this.startPos.x + forwardX * 15.0,
      this.startPos.y + Math.sin(this.firstPersonController.pitch) * 15.0,
      this.startPos.z + forwardZ * 15.0
    );

    // Atualiza a posição de ancoragem do observador para a localização atual
    this.movement.setPosition(this.startPos.x, this.startPos.z);
    this.observerCamera.update(1.0, this.movement.position);

    // Ponto final: posição calculada da câmera aérea de observação
    this.targetPos.copy(this.observerCamera.camera.position);
    this.targetLookAt.copy(this.movement.position);

    this.startFov = 75;
    this.targetFov = 50;

    this.transitionCamera.fov = this.startFov;
    this.transitionCamera.position.copy(this.startPos);
    this.transitionCamera.lookAt(this.startLookAt);
    this.transitionCamera.updateProjectionMatrix();

    this.onModeChange?.(this.mode);
  }

  public update(dt: number, terrain?: ITerrainHeightQueryable): void {
    if (this.mode === CameraMode.OBSERVER) {
      // 1. Processa zoom da roda do mouse
      const wheelDelta = this.input.consumeWheelDelta();
      this.observerCamera.applyWheelZoom(wheelDelta);

      // 2. Processa rotação horizontal com botão direito
      const rotateDeltaX = this.input.consumeRotateDelta();
      this.observerCamera.applyRotation(rotateDeltaX);

      // 3. Atualiza cinemática de deslocamento do observador
      this.movement.update(
        dt,
        this.input,
        this.observerCamera.yaw,
        this.observerCamera.getFrustumSize()
      );

      // 4. Atualiza câmera aérea ortográfica
      this.observerCamera.update(dt, this.movement.position);

    } else if (this.mode === CameraMode.FIRST_PERSON) {
      // Atualiza movimentação em primeira pessoa e acompanhamento de relevo
      if (terrain) {
        this.firstPersonController.update(dt, this.input, terrain);
      }

    } else if (this.mode === CameraMode.TRANSITION_IN) {
      this.transitionTimer += dt;
      const progress = Math.min(1.0, this.transitionTimer / this.transitionDuration);
      // Interpolação cúbica suave (Cubic Ease-In-Out)
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      this.transitionCamera.position.lerpVectors(this.startPos, this.targetPos, ease);
      // Arco suave que mantém a câmera bem alta no ar antes do mergulho final
      const arcBonus = Math.sin(progress * Math.PI) * 28.0;
      this.transitionCamera.position.y += arcBonus;

      // Garantia anti-clipping: a câmera de transição NUNCA pode cortar montanhas ou afundar sob o relevo
      if (terrain) {
        const groundH = terrain.getHeight(this.transitionCamera.position.x, this.transitionCamera.position.z);
        const minSafeY = Math.max(groundH, CONFIG.SEA_LEVEL) + 2.2;
        if (this.transitionCamera.position.y < minSafeY) {
          this.transitionCamera.position.y = minSafeY;
        }
      }

      this.curLookAt.lerpVectors(this.startLookAt, this.targetLookAt, ease);
      this.transitionCamera.lookAt(this.curLookAt);

      this.transitionCamera.fov = this.startFov + (this.targetFov - this.startFov) * ease;
      this.transitionCamera.updateProjectionMatrix();

      if (progress >= 1.0) {
        this.mode = CameraMode.FIRST_PERSON;
        if (terrain) {
          this.firstPersonController.setPosition(this.targetPos.x, this.targetPos.z, terrain);
        }
        this.firstPersonController.setLookDirection(this.targetYaw, this.targetPitch);
        this.onModeChange?.(this.mode);
      }

    } else if (this.mode === CameraMode.TRANSITION_OUT) {
      this.transitionTimer += dt;
      const progress = Math.min(1.0, this.transitionTimer / this.transitionDuration);
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      this.transitionCamera.position.lerpVectors(this.startPos, this.targetPos, ease);
      const arcBonus = Math.sin(progress * Math.PI) * 28.0;
      this.transitionCamera.position.y += arcBonus;

      if (terrain) {
        const groundH = terrain.getHeight(this.transitionCamera.position.x, this.transitionCamera.position.z);
        const minSafeY = Math.max(groundH, CONFIG.SEA_LEVEL) + 2.2;
        if (this.transitionCamera.position.y < minSafeY) {
          this.transitionCamera.position.y = minSafeY;
        }
      }

      this.curLookAt.lerpVectors(this.startLookAt, this.targetLookAt, ease);
      this.transitionCamera.lookAt(this.curLookAt);

      this.transitionCamera.fov = this.startFov + (this.targetFov - this.startFov) * ease;
      this.transitionCamera.updateProjectionMatrix();

      if (progress >= 1.0) {
        this.mode = CameraMode.OBSERVER;
        this.onModeChange?.(this.mode);
      }
    }
  }

  public getPosition(): THREE.Vector3 {
    if (this.mode === CameraMode.FIRST_PERSON) {
      return this.firstPersonController.position;
    } else if (this.mode === CameraMode.TRANSITION_IN || this.mode === CameraMode.TRANSITION_OUT) {
      return this.transitionCamera.position;
    }
    return this.movement.position;
  }

  public setPosition(x: number, z: number): void {
    this.movement.setPosition(x, z);
    this.observerCamera.update(1.0, this.movement.position);
  }

  public setFrustumSize(size: number): void {
    (this.observerCamera as any).frustumSize = size;
    (this.observerCamera as any).targetFrustumSize = size;
    this.observerCamera.updateProjection();
  }

  public setRotation(yaw: number): void {
    this.observerCamera.yaw = yaw;
    (this.observerCamera as any).targetYaw = yaw;
  }

  public getZoomFrustumSize(): number {
    return this.observerCamera.getFrustumSize();
  }

  public getCamera(): THREE.Camera {
    if (this.mode === CameraMode.FIRST_PERSON) {
      return this.firstPersonController.camera;
    } else if (this.mode === CameraMode.TRANSITION_IN || this.mode === CameraMode.TRANSITION_OUT) {
      return this.transitionCamera;
    }
    return this.observerCamera.camera;
  }

  public onResize(): void {
    this.observerCamera.updateProjection();
    this.firstPersonController.onResize();
    this.transitionCamera.aspect = window.innerWidth / window.innerHeight;
    this.transitionCamera.updateProjectionMatrix();
  }
}
