// @ts-nocheck
import * as THREE from 'three';
import { TreeConfig } from '../types';

export class LeafParticleSystem {
  public group: THREE.Group;
  private particleCount: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private rotations: Float32Array;
  private scales: Float32Array;
  private treeBoundsY: { min: number; max: number };
  private snowy = false;

  constructor(config: TreeConfig) {
    this.group = new THREE.Group();
    this.particleCount = config.showFallingLeaves ? config.fallingLeafCount : 0;
    // A snowy tree drops snowflakes instead of leaves.
    this.snowy = (config.snowCover ?? 0) > 0.05;
    this.treeBoundsY = { min: 0.1, max: config.trunkHeight + 3 };

    this.positions = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);
    this.rotations = new Float32Array(this.particleCount);
    this.scales = new Float32Array(this.particleCount);

    this.initParticles(config);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aRotation', new THREE.BufferAttribute(this.rotations, 1));
    this.geometry.setAttribute('aScale', new THREE.BufferAttribute(this.scales, 1));

    // Stylized BotW leaf/petal particle texture generated procedurally
    const particleTexture = this.createLeafTexture(config.species, this.snowy);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTexture: { value: particleTexture },
        uColor: { value: new THREE.Color(this.snowy ? '#f4f8ff' : config.foliageColorTop) },
        uWindSpeed: { value: config.windSpeed },
        uWindStrength: { value: config.windStrength },
      },
      vertexShader: `
        attribute float aRotation;
        attribute float aScale;
        uniform float uTime;
        uniform float uWindSpeed;
        uniform float uWindStrength;
        varying vec2 vUv;
        varying float vAlpha;

        void main() {
          vUv = uv;
          vec3 pos = position;
          
          // Subtle fluttering in vertex position
          pos.x += sin(uTime * uWindSpeed * 2.0 + position.y) * 0.15 * uWindStrength;
          pos.z += cos(uTime * uWindSpeed * 1.5 + position.x) * 0.15 * uWindStrength;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = (35.0 * aScale) * (15.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;

          // Fade out near ground
          vAlpha = smoothstep(0.1, 1.5, position.y);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vAlpha;

        void main() {
          vec4 texColor = texture2D(uTexture, gl_PointCoord);
          if (texColor.a < 0.1) discard;

          vec3 finalColor = uColor * texColor.rgb;
          gl_FragColor = vec4(finalColor, texColor.a * vAlpha * 0.9);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.group.add(this.points);
  }

  private initParticles(config: TreeConfig) {
    const spreadRadius = config.clusterRadius * 2.5 + 2.0;

    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * spreadRadius;
      this.positions[idx] = Math.cos(angle) * r;
      this.positions[idx + 1] = config.trunkHeight * 0.6 + Math.random() * (config.trunkHeight * 0.7);
      this.positions[idx + 2] = Math.sin(angle) * r;

      // Velocities
      this.velocities[idx] = (Math.random() - 0.5) * 0.02; // x drift
      this.velocities[idx + 1] = this.snowy
        ? -(0.006 + Math.random() * 0.01) // snow drifts down slowly
        : -(0.015 + Math.random() * 0.025); // y fall
      this.velocities[idx + 2] = (Math.random() - 0.5) * 0.02; // z drift

      this.rotations[i] = Math.random() * Math.PI * 2;
      // flakes stay small, and smaller still around a sapling, where the
      // camera sits close
      this.scales[i] = this.snowy
        ? (0.22 + Math.random() * 0.22) * THREE.MathUtils.clamp(config.trunkHeight / 6, 0.3, 1)
        : 0.6 + Math.random() * 0.8;
    }
  }

  private createLeafTexture(species: string, snowy = false): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, 64, 64);

    if (snowy) {
      // A pixel snowflake: a small plus on an 8 x 8 grid, kept crisp by
      // nearest filtering (set below).
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(24, 16, 16, 32);
      ctx.fillRect(16, 24, 32, 16);
    } else if (species === 'satori_sakura') {
      // Oval delicate Sakura petal with notch
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(32, 32, 16, 26, Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (species.startsWith('dry_withered')) {
      // Small brittle dried wood speck / twig dust
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.rect(26, 20, 12, 24);
      ctx.fill();
    } else {
      // Classic BotW teardrop leaf shape
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(32, 8);
      ctx.bezierCurveTo(48, 16, 52, 44, 32, 56);
      ctx.bezierCurveTo(12, 44, 16, 16, 32, 8);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = snowy ? THREE.NearestFilter : THREE.LinearFilter;
    texture.magFilter = snowy ? THREE.NearestFilter : THREE.LinearFilter;
    return texture;
  }

  public update(delta: number, config: TreeConfig) {
    if (this.particleCount === 0) return;

    this.material.uniforms.uTime.value += delta;
    this.material.uniforms.uWindSpeed.value = config.windSpeed;
    this.material.uniforms.uWindStrength.value = config.windStrength;

    const windForceX = config.windStrength * 0.04 * config.windSpeed;
    const windForceZ = config.windStrength * 0.015 * config.windSpeed;
    const spreadRadius = config.clusterRadius * 2.5 + 2.0;

    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 3;

      // Swirling drift
      this.positions[idx] += this.velocities[idx] + windForceX + Math.sin(this.positions[idx + 1] * 2) * 0.01;
      this.positions[idx + 1] += this.velocities[idx + 1];
      this.positions[idx + 2] += this.velocities[idx + 2] + windForceZ + Math.cos(this.positions[idx + 1] * 2) * 0.01;

      // Reset when reaching ground or flying too far away
      if (this.positions[idx + 1] <= this.treeBoundsY.min || Math.abs(this.positions[idx]) > spreadRadius * 3) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * spreadRadius;
        this.positions[idx] = Math.cos(angle) * r - windForceX * 20;
        this.positions[idx + 1] = config.trunkHeight * 0.7 + Math.random() * (config.trunkHeight * 0.5);
        this.positions[idx + 2] = Math.sin(angle) * r;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
  }

  public dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
