export class InputManager {
  private keysPressed: Set<string> = new Set();
  private wheelDelta: number = 0;

  // 1. Rotação horizontal da câmera com o botão direito do mouse
  private isRightDragging: boolean = false;
  private rightDragDeltaX: number = 0;
  private prevRightMouseX: number = 0;

  // 2. Pan/Deslocamento do mapa com o botão do meio (scroll click) ou botão esquerdo
  private isPanDragging: boolean = false;
  private panDeltaX: number = 0;
  private panDeltaY: number = 0;
  private prevPanMouseX: number = 0;
  private prevPanMouseY: number = 0;

  // 3. Controles virtuais móveis (touch joystick e gestos)
  private virtualVector: { x: number; y: number } = { x: 0, y: 0 };
  private virtualSprint: boolean = false;

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        this.keysPressed.add(e.code);
        if (e.code.startsWith('Arrow')) {
          e.preventDefault();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysPressed.delete(e.code);
    });

    window.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheelDelta += e.deltaY;
    }, { passive: false });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        // Botão direito: gira a câmera na horizontal
        this.isRightDragging = true;
        this.prevRightMouseX = e.clientX;
      } else if (e.button === 1 || e.button === 0) {
        // Botão do meio ou esquerdo: pan/arrasto pelo terreno
        this.isPanDragging = true;
        this.prevPanMouseX = e.clientX;
        this.prevPanMouseY = e.clientY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isRightDragging) {
        this.rightDragDeltaX += e.clientX - this.prevRightMouseX;
        this.prevRightMouseX = e.clientX;
      }
      if (this.isPanDragging) {
        this.panDeltaX += e.clientX - this.prevPanMouseX;
        this.panDeltaY += e.clientY - this.prevPanMouseY;
        this.prevPanMouseX = e.clientX;
        this.prevPanMouseY = e.clientY;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        this.isRightDragging = false;
      } else if (e.button === 1 || e.button === 0) {
        this.isPanDragging = false;
      }
    });

    window.addEventListener('blur', () => {
      this.isRightDragging = false;
      this.isPanDragging = false;
      this.keysPressed.clear();
    });

    // Desativa o menu de contexto padrão do navegador para liberar o botão direito no jogo
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  public isMovingForward(): boolean {
    return this.keysPressed.has('ArrowUp') || this.keysPressed.has('KeyW') || this.virtualVector.y > 0.15;
  }

  public isMovingBackward(): boolean {
    return this.keysPressed.has('ArrowDown') || this.keysPressed.has('KeyS') || this.virtualVector.y < -0.15;
  }

  public isMovingLeft(): boolean {
    return this.keysPressed.has('ArrowLeft') || this.keysPressed.has('KeyA') || this.virtualVector.x < -0.15;
  }

  public isMovingRight(): boolean {
    return this.keysPressed.has('ArrowRight') || this.keysPressed.has('KeyD') || this.virtualVector.x > 0.15;
  }

  public isSprinting(): boolean {
    return this.keysPressed.has('ShiftLeft') || this.keysPressed.has('ShiftRight') || this.virtualSprint;
  }

  /**
   * Define o vetor analógico de movimentação virtual vindo do joystick touch.
   * forward: -1.0 (trás) a +1.0 (frente)
   * right: -1.0 (esquerda) a +1.0 (direita)
   */
  public setVirtualMovement(forward: number, right: number, sprint?: boolean): void {
    this.virtualVector.x = right;
    this.virtualVector.y = forward;
    if (sprint !== undefined) {
      this.virtualSprint = sprint;
    }
  }

  public setVirtualSprint(sprint: boolean): void {
    this.virtualSprint = sprint;
  }

  /**
   * Retorna o vetor analógico composto (teclado + joystick virtual).
   */
  public getMovementVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keysPressed.has('ArrowUp') || this.keysPressed.has('KeyW')) y += 1;
    if (this.keysPressed.has('ArrowDown') || this.keysPressed.has('KeyS')) y -= 1;
    if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('KeyA')) x -= 1;
    if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('KeyD')) x += 1;

    const keyLen = Math.hypot(x, y);
    if (keyLen > 0) {
      x /= keyLen;
      y /= keyLen;
    }

    // Se o joystick virtual estiver ativo, tem prioridade analógica suave
    const virtLen = Math.hypot(this.virtualVector.x, this.virtualVector.y);
    if (virtLen > 0.001) {
      x = this.virtualVector.x;
      y = this.virtualVector.y;
    }

    return { x, y };
  }

  public addPanDelta(dx: number, dy: number): void {
    this.panDeltaX += dx;
    this.panDeltaY += dy;
  }

  public addRotateDelta(deltaX: number): void {
    this.rightDragDeltaX += deltaX;
  }

  public addWheelDelta(d: number): void {
    this.wheelDelta += d;
  }

  public consumeWheelDelta(): number {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }

  // Retorna o delta acumulado de movimento horizontal do mouse com botão direito
  public consumeRotateDelta(): number {
    const d = this.rightDragDeltaX;
    this.rightDragDeltaX = 0;
    return d;
  }

  // Retorna o delta acumulado de pan com botão do meio/esquerdo
  public consumePanDelta(): { x: number; y: number } {
    const d = { x: this.panDeltaX, y: this.panDeltaY };
    this.panDeltaX = 0;
    this.panDeltaY = 0;
    return d;
  }

  // Compatibilidade com código existente
  public consumeDragDelta(): { x: number; y: number } {
    return this.consumePanDelta();
  }
}
