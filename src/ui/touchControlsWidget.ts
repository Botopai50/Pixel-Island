import { CameraMode, PlayerController } from '../player/playerController.ts';
import { InputManager } from '../player/inputManager.ts';

export class TouchControlsWidget {
  private playerController: PlayerController;
  private inputManager: InputManager;

  private container!: HTMLElement;
  private joystickZone!: HTMLElement;
  private joystickBase!: HTMLElement;
  private joystickKnob!: HTMLElement;
  private sprintBtn!: HTMLElement;

  private hasTouch: boolean = false;
  private currentMode: CameraMode = CameraMode.OBSERVER;

  // Tracking de toques em 1ª Pessoa
  private joystickTouchId: number | null = null;
  private joystickCenter: { x: number; y: number } = { x: 0, y: 0 };
  private joystickRadius: number = 50;

  private lookTouchId: number | null = null;
  private lastLookPos: { x: number; y: number } = { x: 0, y: 0 };
  private lookSensitivity: number = 0.0035;

  private isSprintLocked: boolean = false;

  // Tracking de toques em Modo Observador
  private panTouchId: number | null = null;
  private lastPanPos: { x: number; y: number } = { x: 0, y: 0 };

  private pinchTouchIds: [number, number] | null = null;
  private lastPinchDist: number = 0;
  private lastPinchAngle: number = 0;

  constructor(playerController: PlayerController, inputManager: InputManager) {
    this.playerController = playerController;
    this.inputManager = inputManager;

    this.createDom();
    this.setupTouchDetection();
    this.setupEventListeners();
  }

  private createDom(): void {
    // Container mestre sobreposto à tela
    this.container = document.createElement('div');
    this.container.id = 'touch-controls-container';
    this.container.className = 'touch-controls-container hud-no-drag';
    this.container.style.display = 'none'; // oculto até identificar toque

    // Zona do Joystick (metade inferior esquerda da tela)
    this.joystickZone = document.createElement('div');
    this.joystickZone.className = 'touch-joystick-zone';

    this.joystickBase = document.createElement('div');
    this.joystickBase.className = 'touch-joystick-base';

    this.joystickKnob = document.createElement('div');
    this.joystickKnob.className = 'touch-joystick-knob';

    this.joystickBase.appendChild(this.joystickKnob);
    this.joystickZone.appendChild(this.joystickBase);
    this.container.appendChild(this.joystickZone);

    // Botão de corrida (Sprint) no canto inferior direito
    this.sprintBtn = document.createElement('button');
    this.sprintBtn.className = 'touch-action-btn touch-sprint-btn';
    this.sprintBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/>
      </svg>
      <span>Correr</span>
    `;
    this.container.appendChild(this.sprintBtn);

    document.body.appendChild(this.container);
  }

  private setupTouchDetection(): void {
    // Detecta capacidade touch nativa
    const hasTouchHardware = (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches
    );

    if (hasTouchHardware) {
      this.activateTouchMode();
    }

    // Identificação dinâmica de toque ao primeiro evento de touch/pointerdown
    const onTouchTrigger = (e: Event) => {
      if ((e as PointerEvent).pointerType === 'touch' || e.type === 'touchstart') {
        this.activateTouchMode();
      }
    };

    window.addEventListener('touchstart', onTouchTrigger, { passive: true, once: true });
    window.addEventListener('pointerdown', onTouchTrigger, { passive: true });
  }

  public activateTouchMode(): void {
    if (this.hasTouch) return;
    this.hasTouch = true;
    document.body.classList.add('touch-device');
    this.container.style.display = 'block';
    this.updateControlsForMode();
  }

  public onModeChange(mode: CameraMode): void {
    this.currentMode = mode;
    this.resetTouchState();
    this.updateControlsForMode();
  }

  private updateControlsForMode(): void {
    if (!this.hasTouch) return;

    if (this.currentMode === CameraMode.FIRST_PERSON) {
      this.joystickZone.style.display = 'block';
      this.sprintBtn.style.display = 'flex';
    } else {
      this.joystickZone.style.display = 'none';
      this.sprintBtn.style.display = 'none';
    }
  }

  private setupEventListeners(): void {
    // Botão de Sprint
    this.sprintBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isSprintLocked = !this.isSprintLocked;
      this.sprintBtn.classList.toggle('active', this.isSprintLocked);
      this.inputManager.setVirtualSprint(this.isSprintLocked);
    }, { passive: false });

    // Ouvintes globais na janela para captura contínua e sem perda de dedos
    window.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    window.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    window.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    window.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: false });
  }

  private isEventOnUI(e: Touch): boolean {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return false;
    return !!target.closest('#pegman-widget, .forge-widget-container, .first-person-exit-btn, .touch-sprint-btn, .hud-no-drag');
  }

  private handleTouchStart(e: TouchEvent): void {
    if (!this.hasTouch) {
      this.activateTouchMode();
    }

    const changed = e.changedTouches;

    if (this.currentMode === CameraMode.FIRST_PERSON) {
      for (let i = 0; i < changed.length; i++) {
        const touch = changed[i];
        if (this.isEventOnUI(touch)) continue;

        const isLeftSide = touch.clientX < window.innerWidth * 0.48;

        if (isLeftSide && this.joystickTouchId === null) {
          // Inicia Joystick
          e.preventDefault();
          this.joystickTouchId = touch.identifier;
          this.joystickCenter = { x: touch.clientX, y: touch.clientY };

          this.joystickBase.style.display = 'block';
          this.joystickBase.style.left = `${touch.clientX}px`;
          this.joystickBase.style.top = `${touch.clientY}px`;
          this.joystickKnob.style.transform = 'translate3d(0, 0, 0)';

        } else if (!isLeftSide && this.lookTouchId === null) {
          // Inicia Olhar / Câmera
          e.preventDefault();
          this.lookTouchId = touch.identifier;
          this.lastLookPos = { x: touch.clientX, y: touch.clientY };
        }
      }

    } else if (this.currentMode === CameraMode.OBSERVER) {
      // Modo Observador: 1 dedo = Pan, 2 dedos = Pinch & Rotate
      const activeTouches = e.touches;

      if (activeTouches.length === 1) {
        const touch = activeTouches[0];
        if (!this.isEventOnUI(touch)) {
          this.panTouchId = touch.identifier;
          this.lastPanPos = { x: touch.clientX, y: touch.clientY };
        }
      } else if (activeTouches.length >= 2) {
        const t1 = activeTouches[0];
        const t2 = activeTouches[1];
        if (!this.isEventOnUI(t1) && !this.isEventOnUI(t2)) {
          e.preventDefault();
          this.pinchTouchIds = [t1.identifier, t2.identifier];
          this.lastPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          this.lastPinchAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
        }
      }
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    const touches = e.touches;

    if (this.currentMode === CameraMode.FIRST_PERSON) {
      for (let i = 0; i < touches.length; i++) {
        const touch = touches[i];

        // Atualização do Joystick
        if (touch.identifier === this.joystickTouchId) {
          e.preventDefault();
          const dx = touch.clientX - this.joystickCenter.x;
          const dy = touch.clientY - this.joystickCenter.y;
          const dist = Math.hypot(dx, dy);

          const maxDist = this.joystickRadius;
          const clampedDist = Math.min(dist, maxDist);
          const angle = Math.atan2(dy, dx);

          const knobX = Math.cos(angle) * clampedDist;
          const knobY = Math.sin(angle) * clampedDist;

          this.joystickKnob.style.transform = `translate3d(${knobX}px, ${knobY}px, 0)`;

          // Vetor normalizado analógico: -Y é frente, +Y é trás
          const normX = clampedDist > 0 ? (knobX / maxDist) : 0;
          const normY = clampedDist > 0 ? (-knobY / maxDist) : 0;

          // Se empurrar além de 85%, ativa sprint automático momentâneo
          const autoSprint = this.isSprintLocked || (clampedDist / maxDist > 0.88);
          this.inputManager.setVirtualMovement(normY, normX, autoSprint);

        // Atualização da Câmera (Look)
        } else if (touch.identifier === this.lookTouchId) {
          e.preventDefault();
          const dx = touch.clientX - this.lastLookPos.x;
          const dy = touch.clientY - this.lastLookPos.y;
          this.lastLookPos = { x: touch.clientX, y: touch.clientY };

          // Aplica sensibilidade touch ao olhar
          const fpc = (this.playerController as any).firstPersonController;
          if (fpc && typeof fpc.applyLookDelta === 'function') {
            fpc.applyLookDelta(dx * (this.lookSensitivity / 0.0026), dy * (this.lookSensitivity / 0.0026));
          }
        }
      }

    } else if (this.currentMode === CameraMode.OBSERVER) {
      if (this.pinchTouchIds && touches.length >= 2) {
        // Encontra os 2 dedos do pinch
        let t1: Touch | null = null;
        let t2: Touch | null = null;
        for (let i = 0; i < touches.length; i++) {
          if (touches[i].identifier === this.pinchTouchIds[0]) t1 = touches[i];
          if (touches[i].identifier === this.pinchTouchIds[1]) t2 = touches[i];
        }

        if (t1 && t2) {
          e.preventDefault();
          const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          const currentAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);

          // Variação de Zoom (Pinça)
          const distDelta = currentDist - this.lastPinchDist;
          if (Math.abs(distDelta) > 1.0) {
            // Distância aumentando = zoom in (afasta menos, delta negativo)
            this.inputManager.addWheelDelta(-distDelta * 4.5);
            this.lastPinchDist = currentDist;
          }

          // Variação de Rotação (Twist)
          let angleDelta = currentAngle - this.lastPinchAngle;
          // Normaliza salto de ângulo (-PI a PI)
          if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
          if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;

          if (Math.abs(angleDelta) > 0.015) {
            this.inputManager.addRotateDelta(-angleDelta * 140.0);
            this.lastPinchAngle = currentAngle;
          }
        }

      } else if (this.panTouchId !== null) {
        // Pan com 1 dedo
        for (let i = 0; i < touches.length; i++) {
          if (touches[i].identifier === this.panTouchId) {
            e.preventDefault();
            const dx = touches[i].clientX - this.lastPanPos.x;
            const dy = touches[i].clientY - this.lastPanPos.y;
            this.lastPanPos = { x: touches[i].clientX, y: touches[i].clientY };

            this.inputManager.addPanDelta(dx, dy);
            break;
          }
        }
      }
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    const changed = e.changedTouches;

    for (let i = 0; i < changed.length; i++) {
      const touch = changed[i];

      if (touch.identifier === this.joystickTouchId) {
        this.joystickTouchId = null;
        this.joystickBase.style.display = 'none';
        this.inputManager.setVirtualMovement(0, 0, this.isSprintLocked);

      } else if (touch.identifier === this.lookTouchId) {
        this.lookTouchId = null;

      } else if (touch.identifier === this.panTouchId) {
        this.panTouchId = null;

      } else if (this.pinchTouchIds && (touch.identifier === this.pinchTouchIds[0] || touch.identifier === this.pinchTouchIds[1])) {
        this.pinchTouchIds = null;
      }
    }

    if (e.touches.length === 0) {
      this.resetTouchState();
    }
  }

  private handleTouchCancel(_e: TouchEvent): void {
    this.resetTouchState();
  }

  private resetTouchState(): void {
    this.joystickTouchId = null;
    this.lookTouchId = null;
    this.panTouchId = null;
    this.pinchTouchIds = null;

    if (this.joystickBase) {
      this.joystickBase.style.display = 'none';
      this.joystickKnob.style.transform = 'translate3d(0, 0, 0)';
    }

    this.inputManager.setVirtualMovement(0, 0, this.isSprintLocked);
  }
}
