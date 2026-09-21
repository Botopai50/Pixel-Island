import * as THREE from 'three';
import { RaycastHit } from './terrainRaycaster.ts';

export class DropReticle {
  public group: THREE.Group;
  private ringMesh: THREE.Mesh;
  private discMesh: THREE.Mesh;
  private pointerMesh: THREE.Mesh;
  private ringMaterial: THREE.MeshBasicMaterial;
  private discMaterial: THREE.MeshBasicMaterial;
  private pointerMaterial: THREE.MeshBasicMaterial;

  private isVisible: boolean = false;
  private time: number = 0;

  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    // 1. Anel externo facetado (RingGeometry de 16 segmentos)
    const ringGeo = new THREE.RingGeometry(1.8, 2.3, 16);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xfbc02d,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.ringMesh = new THREE.Mesh(ringGeo, this.ringMaterial);
    this.group.add(this.ringMesh);

    // 2. Disco interno com brilho suave
    const discGeo = new THREE.CircleGeometry(1.5, 16);
    discGeo.rotateX(-Math.PI / 2);
    this.discMaterial = new THREE.MeshBasicMaterial({
      color: 0xffeb3b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35
    });
    this.discMesh = new THREE.Mesh(discGeo, this.discMaterial);
    this.group.add(this.discMesh);

    // 3. Indicador vertical cônico (apontador de localização)
    const pointerGeo = new THREE.ConeGeometry(0.6, 2.2, 5);
    pointerGeo.rotateX(Math.PI); // Ponta voltada para baixo
    pointerGeo.translate(0, 1.8, 0);
    this.pointerMaterial = new THREE.MeshBasicMaterial({
      color: 0xfbc02d,
      transparent: true,
      opacity: 0.9
    });
    this.pointerMesh = new THREE.Mesh(pointerGeo, this.pointerMaterial);
    this.group.add(this.pointerMesh);
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.group.visible = visible;
  }

  public update(dt: number, hit: RaycastHit | null): void {
    if (!this.isVisible || !hit) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;
    this.time += dt;

    // Posiciona suavemente sobre a cota do relevo (+0.12m para evitar z-fighting)
    this.group.position.set(hit.point.x, hit.point.y + 0.14, hit.point.z);

    // Rotação suave do anel
    this.ringMesh.rotation.y = this.time * 1.8;

    // Pulsação rítmica da escala e da flutuação da flecha
    const pulse = 1.0 + Math.sin(this.time * 5.0) * 0.08;
    this.ringMesh.scale.set(pulse, pulse, pulse);
    this.discMesh.scale.set(pulse, pulse, pulse);
    this.pointerMesh.position.y = Math.sin(this.time * 4.0) * 0.35;

    // Cor dinâmica: Amarelo Pegman em terra firme, Ciano em água
    const targetColor = hit.isWater ? 0x00bcd4 : 0xfbc02d;
    this.ringMaterial.color.setHex(targetColor);
    this.discMaterial.color.setHex(targetColor);
    this.pointerMaterial.color.setHex(targetColor);
  }

  public dispose(): void {
    this.ringMesh.geometry.dispose();
    this.discMesh.geometry.dispose();
    this.pointerMesh.geometry.dispose();
    this.ringMaterial.dispose();
    this.discMaterial.dispose();
    this.pointerMaterial.dispose();
  }
}
