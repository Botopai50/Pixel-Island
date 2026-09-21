import { TerrainRaycaster, RaycastHit, ITerrainHeightQueryable } from '../player/terrainRaycaster.ts';
import { DropReticle } from '../player/dropReticle.ts';
import { CameraMode } from '../player/playerController.ts';
import * as THREE from 'three';

export interface PegmanCallbacks {
  onDrop: (x: number, z: number) => void;
  onExitFirstPerson: () => void;
  getActiveCamera: () => THREE.Camera;
  getTerrain: () => ITerrainHeightQueryable;
}

export class PegmanWidget {
  private container!: HTMLElement;
  private pedestal!: HTMLElement;
  private character!: HTMLElement;
  private ghost!: HTMLElement;
  private exitBtn!: HTMLElement;
  private tooltip!: HTMLElement;

  private isDragging: boolean = false;
  private raycaster: TerrainRaycaster = new TerrainRaycaster();
  private reticle: DropReticle;
  private callbacks: PegmanCallbacks;

  private lastHit: RaycastHit | null = null;
  private prevMouseX: number = 0;
  private mouseVelX: number = 0;

  constructor(reticle: DropReticle, callbacks: PegmanCallbacks) {
    this.reticle = reticle;
    this.callbacks = callbacks;

    this.createDom();
    this.setupListeners();
  }

  private createDom(): void {
    // 1. Container principal do widget do Pegman (canto inferior direito)
    this.container = document.createElement('div');
    this.container.id = 'pegman-widget';
    this.container.className = 'pegman-widget hud-no-drag';

    // Tooltip explicativo
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'pegman-tooltip';
    this.tooltip.textContent = 'Arraste para explorar em 1ª Pessoa';
    this.container.appendChild(this.tooltip);

    // Pedestal de vidro fosco
    this.pedestal = document.createElement('div');
    this.pedestal.className = 'pegman-pedestal';

    // Ícone SVG do Pegman estilizado em tons de amarelo low-poly
    this.character = document.createElement('div');
    this.character.className = 'pegman-character';
    this.character.innerHTML = `
      <svg viewBox="0 0 36 50" width="34" height="46" class="pegman-svg">
        <!-- Sombra da cabeça -->
        <circle cx="18" cy="11" r="7.5" fill="#f57f17" />
        <!-- Cabeça amarela luminosa -->
        <circle cx="18" cy="10" r="7.5" fill="#fbc02d" />
        <ellipse cx="16.5" cy="8" rx="4.5" ry="3.5" fill="#fff59d" opacity="0.45" />

        <!-- Tronco e ombros -->
        <path d="M 12 18 L 24 18 L 26 31 L 10 31 Z" fill="#f9a825" />
        <!-- Gravatinha/detalhe frontal -->
        <path d="M 18 18 L 19.5 24 L 18 27 L 16.5 24 Z" fill="#e65100" opacity="0.85" />

        <!-- Braço esquerdo -->
        <path d="M 11 19 L 7 28 L 9 29 L 13 20 Z" fill="#fbc02d" />
        <!-- Braço direito -->
        <path d="M 25 19 L 29 28 L 27 29 L 23 20 Z" fill="#fbc02d" />

        <!-- Pernas -->
        <rect x="11.5" y="31" width="5.5" height="15" rx="2.5" fill="#f57f17" />
        <rect x="19" y="31" width="5.5" height="15" rx="2.5" fill="#f9a825" />
      </svg>
    `;
    this.pedestal.appendChild(this.character);
    this.container.appendChild(this.pedestal);

    // 2. Ghost que segue o cursor ao arrastar (pendurado dinamicamente)
    this.ghost = document.createElement('div');
    this.ghost.id = 'pegman-ghost';
    this.ghost.className = 'pegman-ghost';
    this.ghost.style.display = 'none';
    this.ghost.innerHTML = this.character.innerHTML;

    // 3. Botão de saída da Primeira Pessoa (flutuante)
    this.exitBtn = document.createElement('button');
    this.exitBtn.id = 'first-person-exit-btn';
    this.exitBtn.className = 'first-person-exit-btn hud-no-drag';
    this.exitBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M9 14l-4-4 4-4v3h8v2h-8v3zm11 7H4c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2z"/>
      </svg>
      <span>Voltar à Visão Aérea (ESC)</span>
    `;
    this.exitBtn.style.display = 'none';

    document.body.appendChild(this.container);
    document.body.appendChild(this.ghost);
    document.body.appendChild(this.exitBtn);
  }

  private setupListeners(): void {
    // Inicia arrasto com Pointer Events
    this.character.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.startDrag(e.clientX, e.clientY);
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      this.onDragMove(e.clientX, e.clientY);
    });

    window.addEventListener('pointerup', (e) => {
      if (!this.isDragging) return;
      this.endDrag(e.clientX, e.clientY);
    });

    window.addEventListener('pointercancel', () => {
      if (this.isDragging) {
        this.cancelDrag();
      }
    });

    // Clique no botão de saída
    this.exitBtn.addEventListener('click', () => {
      this.callbacks.onExitFirstPerson();
    });
  }

  private startDrag(clientX: number, clientY: number): void {
    this.isDragging = true;
    this.prevMouseX = clientX;
    this.mouseVelX = 0;

    this.container.classList.add('is-dragging');
    this.ghost.style.display = 'block';
    this.updateGhostPosition(clientX, clientY, 0);

    this.reticle.setVisible(true);
    this.onDragMove(clientX, clientY);
  }

  private onDragMove(clientX: number, clientY: number): void {
    // Calcula velocidade horizontal para inclinar suavemente o boneco pendurado
    const dx = clientX - this.prevMouseX;
    this.mouseVelX += (dx * 1.8 - this.mouseVelX) * 0.35;
    this.prevMouseX = clientX;

    const leanAngle = Math.max(-28, Math.min(28, this.mouseVelX * 1.2));
    this.updateGhostPosition(clientX, clientY, leanAngle);

    // Raycast contínuo contra o terreno procedural
    const camera = this.callbacks.getActiveCamera();
    const terrain = this.callbacks.getTerrain();
    this.lastHit = this.raycaster.castFromScreen(clientX, clientY, camera, terrain);

    this.reticle.update(0.016, this.lastHit);
  }

  private endDrag(_clientX: number, _clientY: number): void {
    this.isDragging = false;
    this.ghost.style.display = 'none';
    this.container.classList.remove('is-dragging');
    this.reticle.setVisible(false);

    if (this.lastHit && this.lastHit.hit) {
      // Soltou sobre um ponto válido da ilha!
      this.callbacks.onDrop(this.lastHit.point.x, this.lastHit.point.z);
    }
  }

  private cancelDrag(): void {
    this.isDragging = false;
    this.ghost.style.display = 'none';
    this.container.classList.remove('is-dragging');
    this.reticle.setVisible(false);
  }

  private updateGhostPosition(x: number, y: number, leanAngle: number): void {
    this.ghost.style.transform = `translate3d(${x - 17}px, ${y - 40}px, 0) rotate(${leanAngle}deg)`;
  }

  /**
   * Atualiza a visibilidade dos elementos da HUD conforme o modo de câmera ativo.
   */
  public onModeChange(mode: CameraMode): void {
    if (mode === CameraMode.OBSERVER) {
      this.container.style.display = 'flex';
      this.exitBtn.style.display = 'none';
    } else if (mode === CameraMode.FIRST_PERSON) {
      this.container.style.display = 'none';
      this.exitBtn.style.display = 'inline-flex';
    } else if (mode === CameraMode.TRANSITION_IN) {
      this.container.style.display = 'none';
      this.exitBtn.style.display = 'none';
    } else if (mode === CameraMode.TRANSITION_OUT) {
      this.container.style.display = 'none';
      this.exitBtn.style.display = 'none';
    }
  }

  public getIsDragging(): boolean {
    return this.isDragging;
  }
}
