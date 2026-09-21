import * as THREE from 'three';
import { GeothermalGenerator, ThermalSpring } from './geothermalGenerator.ts';

export class GeothermalManager {
  private generator: GeothermalGenerator;
  private springs: ThermalSpring[] = [];
  private group: THREE.Group;
  private geyserParticles: THREE.Points[] = [];
  private steamParticles: THREE.Points[] = [];
  private poolMaterial!: THREE.ShaderMaterial;
  private poolMeshes: THREE.Mesh[] = [];
  private elapsedTime: number = 0;

  constructor(scene: THREE.Scene, geothermalGen: GeothermalGenerator) {
    this.generator = geothermalGen;
    this.springs = this.generator.getSprings();
    this.group = new THREE.Group();
    this.group.name = 'geothermal_features';
    scene.add(this.group);
    this.initPoolMaterial();
    this.buildPoolWaterMeshes();
    this.buildGeysersAndSteam();
  }

  public reseed(seed: number): void {
    this.generator.reseed(seed);
    this.springs = this.generator.getSprings();
    this.rebuildAll();
  }

  private rebuildAll(): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }
    this.poolMeshes = [];
    this.geyserParticles = [];
    this.steamParticles = [];
    this.buildPoolWaterMeshes();
    this.buildGeysersAndSteam();
  }

  private initPoolMaterial(): void {
    this.poolMaterial = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0.0 },
        uCenterColor: { value: new THREE.Color('#0fb89a') }, // Turquesa geotermal profundo límpido
        uEdgeColor: { value: new THREE.Color('#58e6d2') },   // Azul turquesa claro brilhante
        uRimColor: { value: new THREE.Color('#f0fbf9') }     // Espuma/vapor mineral nas bordas
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          // Micromovimento de convecção hidrotérmica
          float ripple = sin(worldPos.x * 0.8 + uTime * 2.0) * cos(worldPos.z * 0.8 + uTime * 1.8) * 0.04;
          worldPos.y += ripple;
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uCenterColor;
        uniform vec3 uEdgeColor;
        uniform vec3 uRimColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          float dist = length(vUv - vec2(0.5)) * 2.0;
          float wave = sin(dist * 16.0 - uTime * 2.6) * 0.035;
          float normD = clamp(dist + wave, 0.0, 1.0);

          vec3 col = mix(uCenterColor, uEdgeColor, smoothstep(0.12, 0.90, normD));
          float rimShimmer = smoothstep(0.80, 0.98, normD);
          col = mix(col, uRimColor, rimShimmer * 0.65);

          float alpha = clamp(0.86 + rimShimmer * 0.12, 0.0, 0.96);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
  }

  private buildPoolWaterMeshes(): void {
    for (const spring of this.springs) {
      // Malha horizontal de água líquida ocupando o interior da bacia
      const geo = new THREE.CircleGeometry(spring.radius * 0.90, 36);
      geo.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(geo, this.poolMaterial);
      mesh.position.set(spring.x, spring.waterLevel, spring.z);
      this.poolMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  public query(x: number, z: number, currentElevation: number = 16.0) {
    return this.generator.query(x, z, currentElevation);
  }

  private buildGeysersAndSteam(): void {
    // 1. Partículas de vapor contínuo sobre todas as piscinas
    for (const spring of this.springs) {
      const steamCount = 35;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(steamCount * 3);
      const vel = new Float32Array(steamCount * 3);

      for (let i = 0; i < steamCount; i++) {
        const r = Math.random() * (spring.radius * 0.75);
        const theta = Math.random() * Math.PI * 2;
        pos[i * 3] = spring.x + Math.cos(theta) * r;
        pos[i * 3 + 1] = spring.waterLevel + Math.random() * 2.5;
        pos[i * 3 + 2] = spring.z + Math.sin(theta) * r;

        vel[i * 3] = (Math.random() - 0.5) * 0.8;
        vel[i * 3 + 1] = 0.8 + Math.random() * 1.2;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      }

      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('velocity', new THREE.BufferAttribute(vel, 3));

      const mat = new THREE.PointsMaterial({
        color: 0xf4ffff,
        size: 3.2,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending
      });

      const steam = new THREE.Points(geo, mat);
      (steam as any).__spring = spring;
      this.steamParticles.push(steam);
      this.group.add(steam);
    }

    // 2. Jatos eruptivos dos gêiseres nas duas fontes ativas
    for (const spring of this.springs) {
      if (!spring.isGeyser) continue;

      const count = 90;
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        positions[i * 3] = spring.x + (Math.random() - 0.5) * 1.8;
        positions[i * 3 + 1] = spring.waterLevel;
        positions[i * 3 + 2] = spring.z + (Math.random() - 0.5) * 1.8;

        velocities[i * 3] = (Math.random() - 0.5) * 2.0;
        velocities[i * 3 + 1] = 16.0 + Math.random() * 14.0;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
      }

      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

      const mat = new THREE.PointsMaterial({
        color: 0xdef7ff,
        size: 2.5,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending
      });

      const p = new THREE.Points(geo, mat);
      (p as any).__spring = spring;
      this.geyserParticles.push(p);
      this.group.add(p);
    }
  }

  public update(dt: number): void {
    this.elapsedTime += dt;
    if (this.poolMaterial) {
      this.poolMaterial.uniforms.uTime.value += dt;
    }

    // Atualiza vapor suave
    for (const s of this.steamParticles) {
      const spring: ThermalSpring = (s as any).__spring;
      const pos = s.geometry.attributes.position as THREE.BufferAttribute;
      const vel = s.geometry.attributes.velocity as THREE.BufferAttribute;
      const count = pos.count;

      for (let i = 0; i < count; i++) {
        let y = pos.getY(i) + vel.getY(i) * dt;
        let x = pos.getX(i) + vel.getX(i) * dt;
        let z = pos.getZ(i) + vel.getZ(i) * dt;

        if (y > spring.waterLevel + 8.0) {
          const r = Math.random() * (spring.radius * 0.75);
          const theta = Math.random() * Math.PI * 2;
          x = spring.x + Math.cos(theta) * r;
          y = spring.waterLevel + 0.2;
          z = spring.z + Math.sin(theta) * r;
        }

        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }

    // Atualiza gêiseres
    for (const p of this.geyserParticles) {
      const spring: ThermalSpring = (p as any).__spring;
      const cycle = this.elapsedTime % spring.geyserInterval;
      const isErupting = cycle < spring.geyserDuration;

      const pos = p.geometry.attributes.position as THREE.BufferAttribute;
      const vel = p.geometry.attributes.velocity as THREE.BufferAttribute;
      const count = pos.count;

      if (!isErupting) {
        p.visible = false;
        continue;
      }

      p.visible = true;
      const eruptionIntensity = Math.sin((cycle / spring.geyserDuration) * Math.PI);

      for (let i = 0; i < count; i++) {
        let y = pos.getY(i) + vel.getY(i) * dt * eruptionIntensity;
        let x = pos.getX(i) + vel.getX(i) * dt;
        let z = pos.getZ(i) + vel.getZ(i) * dt;

        if (y > spring.waterLevel + 28.0 || Math.random() < 0.04) {
          x = spring.x + (Math.random() - 0.5) * 1.6;
          y = spring.waterLevel;
          z = spring.z + (Math.random() - 0.5) * 1.6;
        }

        pos.setXYZ(i, x, y, z);
      }

      pos.needsUpdate = true;
    }
  }

  public getSprings(): ThermalSpring[] {
    return this.springs;
  }
}
