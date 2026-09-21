import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Previne emissão repetida de warnings quando toNonIndexed() é chamado em geometrias já não-indexadas
const origToNonIndexed = THREE.BufferGeometry.prototype.toNonIndexed;
THREE.BufferGeometry.prototype.toNonIndexed = function(): THREE.BufferGeometry {
  if (!this.getIndex()) return this;
  return origToNonIndexed.call(this);
};

/**
 * BotanicalGeometryFactory
 * Gerador de alta fidelidade botânica e artística para os 19 espécimes vegetais.
 * Incorpora:
 * - Contrafortes radiculares e troncos sinuosos
 * - Saias coníferas com verticilos e recortes de agulhas
 * - Frondes catenárias arqueadas com folíolos
 * - Cactos canelados com cotovelos orgânicos em arco
 * - Raízes-escora de manguezal em arco catenário
 * - Propágulo vivíparo autêntico
 * - Árvore calcinada com fendas e brasas internas
 * - Normais esferizadas para iluminação suave estilo The Witness / Ghibli
 * - Oclusão de contato e gradientes via Vertex Colors
 */
export class BotanicalGeometryFactory {

  // =========================================================================
  // FUNÇÕES AUXILIARES DE PROCESSAMENTO GEOMÉTRICO
  // =========================================================================

  /**
   * Recalcula as normais dos vértices apontando a partir de um centro esférico virtual.
   * Cria o sombreamento volumétrico pictórico e fofo característico de The Witness.
   */
  public static spherizeNormals(geo: THREE.BufferGeometry, center: THREE.Vector3): THREE.BufferGeometry {
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    const pos = nonIndexed.attributes.position;
    const normals = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      v.sub(center).normalize();
      normals[i * 3] = v.x;
      normals[i * 3 + 1] = v.y;
      normals[i * 3 + 2] = v.z;
    }

    nonIndexed.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return nonIndexed;
  }

  /**
   * Aplica gradiente vertical de cores de vértice com oclusão ambiente na base/interior.
   */
  public static applyVertexAO(
    geo: THREE.BufferGeometry,
    minY: number,
    maxY: number,
    baseColor: THREE.Color,
    tipColor: THREE.Color
  ): THREE.BufferGeometry {
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    const pos = nonIndexed.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.clamp((y - minY) / Math.max(maxY - minY, 0.001), 0, 1);
      // Curva cúbica para reforçar a oclusão na base sombreada
      const factor = t * t * (3 - 2 * t);
      c.copy(baseColor).lerp(tipColor, factor);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return nonIndexed;
  }

  /**
   * Cria um tufo foliar orgânico e volumétrico (*puffy cumulus foliage*)
   * com geometria subdividida suave, perturbação botânica e repetição UV precisa.
   * Elimina completamente o aspecto de origami/disco-ball/dodecaedro facetado.
   */
  public static createLeafPuff(
    radius: number,
    scaleY: number,
    centerOffset: THREE.Vector3 = new THREE.Vector3()
  ): THREE.BufferGeometry {
    // Icosaedro com detalhe 2: 320 faces triangulares suaves (Shade Smooth real)
    const geo = new THREE.IcosahedronGeometry(radius, 2);
    const pos = geo.attributes.position;

    // Repetição de UV adaptada à dimensão física do tufo (permite ler centenas de folhas reais de 8-10cm)
    const repeatU = Math.max(3, Math.round(radius * 1.8));
    const repeatV = Math.max(2, Math.round(radius * 1.5 * scaleY));
    const uvs = new Float32Array(pos.count * 2);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const len = Math.hypot(x, y, z);

      if (len > 0.001) {
        const nx = x / len;
        const ny = y / len;
        const nz = z / len;

        // Modulação volumétrica de tufo vegetal vivo (nódulos de folhas sem quebras afiadas)
        const bump = Math.sin(nx * 4.5) * Math.cos(nz * 4.5) * 0.07 + Math.sin(ny * 3.5 + nx * 2.5) * 0.05;
        const rMod = len * (1.0 + bump);

        const newX = nx * rMod * 1.15;
        const newY = ny * rMod * scaleY;
        const newZ = nz * rMod * 1.15;
        pos.setXYZ(i, newX, newY, newZ);

        // Mapeamento de textura contínuo por projeção cilíndrica com repetição calibrada
        const u = (Math.atan2(newZ, newX) / (Math.PI * 2) + 0.5) * repeatU;
        const v = (newY / (radius * 2.0 * scaleY) + 0.5) * repeatV;
        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
      }
    }

    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.computeVertexNormals();

    // Normais esferizadas para iluminação suave e pictórica estilo Studio Ghibli / The Witness
    return this.spherizeNormals(geo, centerOffset);
  }

  /**
   * Cria um tronco com contrafortes radiais (sapopembas) alargados na base.
   */
  public static createButtressTrunk(
    height: number,
    baseR: number,
    topR: number,
    buttressCount: number,
    buttressFlare: number,
    radialSegs: number = 8,
    heightSegs: number = 8
  ): THREE.BufferGeometry {
    const geo = new THREE.CylinderGeometry(topR, baseR, height, radialSegs, heightSegs, false);
    const pos = geo.attributes.position;

    // Modificar anéis de altura: o anel mais baixo (y=-height/2) se expande nos eixos das sapopembas
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const normalizedH = (y + height / 2) / height; // 0 na base, 1 no topo

      if (normalizedH < 0.35) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const angle = Math.atan2(z, x);
        const currentR = Math.sqrt(x * x + z * z);

        // Modulação senoidal dos contrafortes
        const buttressMod = Math.pow(Math.max(0, Math.cos(angle * buttressCount)), 2.5);
        const flareWeight = (1.0 - normalizedH / 0.35);
        const newR = currentR + buttressMod * buttressFlare * flareWeight;

        pos.setX(i, Math.cos(angle) * newR);
        pos.setZ(i, Math.sin(angle) * newR);
      }
    }

    geo.computeVertexNormals();
    geo.translate(0, height / 2, 0);
    return geo;
  }

  /**
   * Cria um tubo curvo contínuo passando por uma lista de nós 3D.
   */
  public static createCurvedTube(
    points: THREE.Vector3[],
    radiusStart: number,
    radiusEnd: number,
    radialSegs: number = 6,
    tubularSegs: number = 10
  ): THREE.BufferGeometry {
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, tubularSegs, 1.0, radialSegs, false);
    const pos = geo.attributes.position;

    // Ajustar conicidade do tubo do início ao fim
    const pOnCurve = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const u = Math.floor(i / (radialSegs + 1)) / tubularSegs;
      const tRadius = THREE.MathUtils.lerp(radiusStart, radiusEnd, u);
      curve.getPointAt(u, pOnCurve);
      curve.getTangentAt(u, tangent);

      const vx = pos.getX(i) - pOnCurve.x;
      const vy = pos.getY(i) - pOnCurve.y;
      const vz = pos.getZ(i) - pOnCurve.z;

      pos.setXYZ(i, pOnCurve.x + vx * tRadius, pOnCurve.y + vy * tRadius, pOnCurve.z + vz * tRadius);
    }

    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Cria uma saia conífera recortada em low-poly com pontas e verticilos.
   */
  public static createConiferSkirt(
    radius: number,
    height: number,
    tipsCount: number,
    droop: number = 0.25,
    curlUp: number = 0.15
  ): THREE.BufferGeometry {
    const radialSegs = tipsCount * 2;
    const cone = new THREE.ConeGeometry(radius, height, radialSegs, 2, true);
    const pos = cone.attributes.position;
    const rimIndices: number[] = [];

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const isRim = y < -height / 2 + 0.05;

      if (isRim) {
        rimIndices.push(i);
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const angle = Math.atan2(z, x);
        const tipIndex = Math.round((angle / (Math.PI * 2)) * tipsCount);
        const isTip = (Math.abs(angle - (tipIndex * (Math.PI * 2)) / tipsCount) < (Math.PI / tipsCount) * 0.45);

        if (isTip) {
          // Ponta projeta-se para fora e levemente para cima
          pos.setX(i, x * 1.25);
          pos.setZ(i, z * 1.25);
          pos.setY(i, y + curlUp);
        } else {
          // Vale intermediário recua para dentro e desce
          pos.setX(i, x * 0.78);
          pos.setZ(i, z * 0.78);
          pos.setY(i, y - droop);
        }
      }
    }

    // Fundo sólido da saia (bottom cap) fechando a parte inferior para visão de baixo
    const bottomVerts: number[] = [];
    const bottomUVs: number[] = [];
    const centerY = -height / 2 + droop * 0.25;

    for (let i = 0; i < rimIndices.length - 1; i++) {
      const idxA = rimIndices[i];
      const idxB = rimIndices[i + 1];

      bottomVerts.push(0, centerY, 0);
      bottomVerts.push(pos.getX(idxB), pos.getY(idxB), pos.getZ(idxB));
      bottomVerts.push(pos.getX(idxA), pos.getY(idxA), pos.getZ(idxA));

      bottomUVs.push(0.5, 0.5);
      bottomUVs.push(cone.attributes.uv.getX(idxB), cone.attributes.uv.getY(idxB));
      bottomUVs.push(cone.attributes.uv.getX(idxA), cone.attributes.uv.getY(idxA));
    }

    const bottomGeo = new THREE.BufferGeometry();
    bottomGeo.setAttribute('position', new THREE.Float32BufferAttribute(bottomVerts, 3));
    bottomGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bottomUVs, 2));
    bottomGeo.computeVertexNormals();

    const nonIndexedCone = cone.toNonIndexed();
    const merged = BufferGeometryUtils.mergeGeometries([nonIndexedCone, bottomGeo])!;
    merged.computeVertexNormals();
    return merged;
  }

  /**
   * Cria uma fronde de coqueiro curvada em arco parabólico natural com folíolos estilizados.
   */
  public static createCurvedFrond(
    length: number,
    baseWidth: number,
    archRise: number,
    curveDrop: number,
    segments: number = 8
  ): THREE.BufferGeometry {
    const geos: THREE.BufferGeometry[] = [];

    for (let s = 0; s < segments; s++) {
      const t1 = s / segments;
      const t2 = (s + 1) / segments;

      // Parábola de fronde tropical: sobe suavemente na primeira metade e curva graciosamente para baixo nas pontas
      const y1 = Math.sin(t1 * Math.PI * 0.7) * archRise - Math.pow(t1, 1.8) * curveDrop;
      const y2 = Math.sin(t2 * Math.PI * 0.7) * archRise - Math.pow(t2, 1.8) * curveDrop;
      const z1 = t1 * length;
      const z2 = t2 * length;

      const w1 = baseWidth * Math.sin(t1 * Math.PI * 0.85 + 0.12);
      const w2 = baseWidth * Math.sin(t2 * Math.PI * 0.85 + 0.12);

      // Folíolos arqueados em diedro sutil (V invertido como palma natural)
      const droop1 = w1 * 0.22;
      const droop2 = w2 * 0.22;

      // Losango ou par de triângulos planos
      const segGeo = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        // Asa esquerda
        -w1, y1 - droop1, z1,   0, y1, z1,   0, y2, z2,
        -w1, y1 - droop1, z1,   0, y2, z2,  -w2, y2 - droop2, z2,
        // Asa direita
        0, y1, z1,    w1, y1 - droop1, z1,   0, y2, z2,
        w1, y1 - droop1, z1,   w2, y2 - droop2, z2,   0, y2, z2,
      ]);
      const uvs = new Float32Array([
        0.05, t1,   0.50, t1,   0.50, t2,
        0.05, t1,   0.50, t2,   0.05, t2,
        0.50, t1,   0.95, t1,   0.50, t2,
        0.95, t1,   0.95, t2,   0.50, t2
      ]);
      segGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      segGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geos.push(segGeo);
    }

    const merged = BufferGeometryUtils.mergeGeometries(geos.map(g => g.toNonIndexed()))!;
    merged.computeVertexNormals();
    return merged;
  }

  /**
   * Cria um cacto canelado com seção estrelada (ribs/caneluras reais).
   */
  public static createFlutedCactusSegment(
    height: number,
    radius: number,
    ribsCount: number = 10,
    ribDepth: number = 0.08,
    curveX: number = 0,
    curveZ: number = 0
  ): THREE.BufferGeometry {
    const radialSegs = ribsCount * 2;
    const heightSegs = 6;
    const geo = new THREE.CylinderGeometry(radius, radius, height, radialSegs, heightSegs, false);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const tY = (y + height / 2) / height;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const angle = Math.atan2(z, x);

      // Efeito de canelura estrelada
      const ribMod = (Math.cos(angle * ribsCount) >= 0 ? 1 : -1) * ribDepth;
      const currentR = Math.sqrt(x * x + z * z);
      const newR = Math.max(0.1, currentR + ribMod);

      // Curvatura suave se solicitada
      const offX = Math.sin(tY * Math.PI) * curveX;
      const offZ = Math.sin(tY * Math.PI) * curveZ;

      pos.setX(i, Math.cos(angle) * newR + offX);
      pos.setZ(i, Math.sin(angle) * newR + offZ);
    }

    geo.computeVertexNormals();
    geo.translate(0, height / 2, 0);
    return geo;
  }

  // =========================================================================
  // MODELOS 1 A 19 - DEFINIÇÕES BOTÂNICAS COMPLETAS
  // =========================================================================

  // 1. CARVALHO TEMPERADO ADULTO (Mature Oak)
  public static buildMatureOak(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Tronco robusto com 4 contrafortes radiculares flaring até 1.35m na base
    const baseTrunk = this.createButtressTrunk(5.4, 0.95, 0.52, 4, 0.45, 8, 8);

    // 4 galhos mestres sinuosos conectando o tronco à copa
    const b1Pts = [new THREE.Vector3(0, 3.8, 0), new THREE.Vector3(-0.9, 4.6, 0.3), new THREE.Vector3(-1.8, 5.8, 0.6)];
    const b2Pts = [new THREE.Vector3(0, 4.0, 0), new THREE.Vector3(0.8, 4.8, -0.4), new THREE.Vector3(1.7, 5.9, -0.8)];
    const b3Pts = [new THREE.Vector3(0, 4.3, 0), new THREE.Vector3(0.2, 5.1, 1.0), new THREE.Vector3(0.4, 6.2, 1.8)];
    const b4Pts = [new THREE.Vector3(0, 4.5, 0), new THREE.Vector3(-0.3, 5.3, -0.9), new THREE.Vector3(-0.6, 6.4, -1.6)];

    const b1 = this.createCurvedTube(b1Pts, 0.38, 0.22, 5, 5);
    const b2 = this.createCurvedTube(b2Pts, 0.36, 0.20, 5, 5);
    const b3 = this.createCurvedTube(b3Pts, 0.34, 0.18, 5, 5);
    const b4 = this.createCurvedTube(b4Pts, 0.32, 0.18, 5, 5);

    const trunkMerged = BufferGeometryUtils.mergeGeometries([baseTrunk, b1, b2, b3, b4].map(g => g.toNonIndexed()))!;
    this.applyVertexAO(trunkMerged, 0, 6.5, new THREE.Color(0x744e36), new THREE.Color(0xa67c54));

    // Copa ampla: 14 aglomerados facetados escalonados com frestas de luz (sky-holes)
    const leafClusters: THREE.BufferGeometry[] = [];
    const clusterPositions = [
      { pos: new THREE.Vector3(0, 8.8, 0), r: 3.2, sY: 1.0 },
      { pos: new THREE.Vector3(-1.9, 7.5, 0.7), r: 2.5, sY: 0.9 },
      { pos: new THREE.Vector3(1.8, 7.6, -0.8), r: 2.6, sY: 0.9 },
      { pos: new THREE.Vector3(0.5, 7.8, 1.9), r: 2.4, sY: 0.85 },
      { pos: new THREE.Vector3(-0.7, 7.9, -1.8), r: 2.4, sY: 0.85 },
      // Camada superior
      { pos: new THREE.Vector3(0.9, 9.8, 0.4), r: 2.2, sY: 0.95 },
      { pos: new THREE.Vector3(-0.8, 9.9, -0.5), r: 2.1, sY: 0.95 },
      { pos: new THREE.Vector3(0, 11.2, 0), r: 1.8, sY: 0.9 },
      // Franjas periféricas pendentes
      { pos: new THREE.Vector3(-2.8, 6.5, 0.2), r: 1.6, sY: 0.8 },
      { pos: new THREE.Vector3(2.7, 6.6, -0.3), r: 1.7, sY: 0.8 },
      { pos: new THREE.Vector3(0.2, 6.7, 2.7), r: 1.6, sY: 0.8 },
      { pos: new THREE.Vector3(-0.4, 6.8, -2.6), r: 1.5, sY: 0.8 },
      { pos: new THREE.Vector3(-1.4, 8.8, 1.5), r: 1.7, sY: 0.85 },
      { pos: new THREE.Vector3(1.5, 8.9, -1.4), r: 1.8, sY: 0.85 }
    ];

    for (const cp of clusterPositions) {
      const d = new THREE.DodecahedronGeometry(cp.r, 2);
      d.scale(1.2, cp.sY, 1.2);
      d.translate(cp.pos.x, cp.pos.y, cp.pos.z);
      this.spherizeNormals(d, cp.pos.clone().add(new THREE.Vector3(0, -0.5, 0)));
      leafClusters.push(d);
    }

    const leavesMerged = BufferGeometryUtils.mergeGeometries(leafClusters.map(g => g.toNonIndexed()))!;
    // Gradiente vertical de iluminação suave nos vértices (profundidade na base, crista luminosa no topo)
    this.applyVertexAO(leavesMerged, 5.5, 12.0, new THREE.Color(0x2e6622), new THREE.Color(0x76d83c));

    return { trunk: trunkMerged, leaves: leavesMerged };
  }

  // 2. MUDA DE CARVALHO (Oak Sapling)
  public static buildOakSapling(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Caule tenro e flexível em "S" com cor jovem esverdeada
    const stemPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.08, 0.8, 0.04),
      new THREE.Vector3(-0.06, 1.6, -0.05),
      new THREE.Vector3(0.04, 2.4, 0.02)
    ];
    const stem = this.createCurvedTube(stemPts, 0.09, 0.05, 5, 6);
    this.applyVertexAO(stem, 0, 2.4, new THREE.Color(0x3d301e), new THREE.Color(0x6e7834));

    // Folhagem em leque de plântula: 6 placas foliares lobadas estilizadas
    const leafPlates: THREE.BufferGeometry[] = [];
    const leafAngles = [0, 1.1, 2.2, 3.4, 4.5, 5.6];
    for (let i = 0; i < leafAngles.length; i++) {
      const a = leafAngles[i];
      const plate = new THREE.DodecahedronGeometry(0.55 + (i % 2) * 0.15, 0);
      plate.scale(1.2, 0.35, 0.8);
      plate.rotateZ(0.35);
      plate.rotateY(a);
      plate.translate(Math.cos(a) * 0.35, 1.8 + i * 0.22, Math.sin(a) * 0.35);
      leafPlates.push(plate);
    }
    // Gema apical tenra
    const bud = new THREE.ConeGeometry(0.12, 0.35, 4);
    bud.translate(0.04, 3.2, 0.02);
    leafPlates.push(bud);

    const leavesMerged = BufferGeometryUtils.mergeGeometries(leafPlates.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 1.5, 3.4, new THREE.Color(0x2d5218), new THREE.Color(0x8cd638));

    return { trunk: stem, leaves: leavesMerged };
  }

  // 3. PINHEIRO ADULTO (Mature Pine)
  public static buildMaturePine(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Fuste reto conífero contínuo desde o solo até o topo apical (excurrent trunk contínuo)
    const trunkFull = this.createButtressTrunk(15.6, 0.76, 0.12, 4, 0.28, 7, 12);

    // Esqueleto de galhos estruturais sob cada saia conectados ao fuste central contínuo
    const branchGeos: THREE.BufferGeometry[] = [trunkFull];
    const tiers = [
      { y: 5.5, r: 3.8, h: 3.5, tips: 9 },
      { y: 8.2, r: 3.1, h: 3.2, tips: 8 },
      { y: 10.8, r: 2.4, h: 2.9, tips: 7 },
      { y: 13.0, r: 1.7, h: 2.6, tips: 6 },
      { y: 14.8, r: 0.95, h: 2.2, tips: 5 }
    ];

    for (const t of tiers) {
      for (let b = 0; b < 4; b++) {
        const bAngle = (b / 4) * Math.PI * 2 + t.y * 1.2;
        const bPts = [
          new THREE.Vector3(0, t.y - 0.2, 0),
          new THREE.Vector3(Math.cos(bAngle) * t.r * 0.55, t.y - 0.45, Math.sin(bAngle) * t.r * 0.55)
        ];
        const bGeo = this.createCurvedTube(bPts, 0.18, 0.08, 4, 3);
        branchGeos.push(bGeo);
      }
    }
    const fullTrunk = BufferGeometryUtils.mergeGeometries(branchGeos.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(fullTrunk, 0, 15.6, new THREE.Color(0x684a32), new THREE.Color(0x946e4c));

    // Saias foliares com recortes denteados low-poly e pontas arrebitadas (com fundo fechado sólido)
    const skirtGeos: THREE.BufferGeometry[] = [];
    for (const t of tiers) {
      const skirt = this.createConiferSkirt(t.r, t.h, t.tips, 0.35, 0.22);
      skirt.translate(0, t.y, 0);
      skirtGeos.push(skirt);
    }
    // Topo apical pontiagudo
    const apex = new THREE.ConeGeometry(0.45, 1.4, 5);
    apex.translate(0, 16.0, 0);
    skirtGeos.push(apex);

    const leavesMerged = BufferGeometryUtils.mergeGeometries(skirtGeos.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 4.0, 16.5, new THREE.Color(0x28562e), new THREE.Color(0x56a65e));

    return { trunk: fullTrunk, leaves: leavesMerged };
  }

  // 4. MUDA DE PINHEIRO (Pine Sapling)
  public static buildPineSapling(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    const stem = new THREE.CylinderGeometry(0.06, 0.12, 3.6, 5);
    stem.translate(0, 1.8, 0);
    this.applyVertexAO(stem, 0, 3.6, new THREE.Color(0x5c422d), new THREE.Color(0x866446));

    // Pincel de acículas eriçadas em espiral ao longo da haste
    const needles: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const hNorm = i / 7;
      const r = 0.85 * (1.0 - hNorm * 0.7);
      const skirt = this.createConiferSkirt(r, 0.7, 5, 0.15, 0.12);
      skirt.translate(0, 0.5 + hNorm * 3.0, 0);
      needles.push(skirt);
    }
    const apex = new THREE.ConeGeometry(0.18, 0.6, 4);
    apex.translate(0, 3.6, 0);
    needles.push(apex);

    const leavesMerged = BufferGeometryUtils.mergeGeometries(needles.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 0.5, 3.8, new THREE.Color(0x2c5c32), new THREE.Color(0x62b852));

    return { trunk: stem, leaves: leavesMerged };
  }

  // 5. BÉTULA BRANCA ADULTA (Mature Birch)
  public static buildMatureBirch(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Tronco esbelto e elegante com ligeira curvatura em "S"
    const trunkPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.15, 3.0, -0.1),
      new THREE.Vector3(-0.1, 6.0, 0.15),
      new THREE.Vector3(0.05, 9.5, 0.0)
    ];
    const mainTrunk = this.createCurvedTube(trunkPts, 0.42, 0.22, 6, 8);

    // Duas forquilhas superiores divergentes
    const fork1Pts = [new THREE.Vector3(0.05, 9.5, 0.0), new THREE.Vector3(-0.6, 11.2, 0.3), new THREE.Vector3(-1.1, 12.8, 0.5)];
    const fork2Pts = [new THREE.Vector3(0.05, 9.5, 0.0), new THREE.Vector3(0.7, 11.4, -0.2), new THREE.Vector3(1.2, 13.0, -0.4)];
    const fork1 = this.createCurvedTube(fork1Pts, 0.20, 0.12, 5, 5);
    const fork2 = this.createCurvedTube(fork2Pts, 0.18, 0.11, 5, 5);

    const trunkMerged = BufferGeometryUtils.mergeGeometries([mainTrunk, fork1, fork2].map(g => g.toNonIndexed()))!;
    // Base escura fendada, transicionando para branco perolado acetinado
    this.applyVertexAO(trunkMerged, 0, 10.0, new THREE.Color(0x4a4642), new THREE.Color(0xf4f2ea));

    // Folhagem translúcida em véus descendentes (estilo The Witness)
    const veilGeos: THREE.BufferGeometry[] = [];
    const veilCenters = [
      { pos: new THREE.Vector3(-0.8, 8.5, 0.4), r: 2.1, sY: 1.3 },
      { pos: new THREE.Vector3(0.7, 8.8, -0.4), r: 2.0, sY: 1.3 },
      { pos: new THREE.Vector3(0, 10.5, 0), r: 1.9, sY: 1.25 },
      { pos: new THREE.Vector3(-0.4, 11.8, 0.2), r: 1.5, sY: 1.15 },
      // Franjas pendentes
      { pos: new THREE.Vector3(-1.4, 7.4, 0.6), r: 1.3, sY: 1.4 },
      { pos: new THREE.Vector3(1.3, 7.5, -0.5), r: 1.3, sY: 1.4 }
    ];

    for (const vc of veilCenters) {
      const d = new THREE.DodecahedronGeometry(vc.r, 2);
      d.scale(1.1, vc.sY, 1.1);
      d.translate(vc.pos.x, vc.pos.y, vc.pos.z);
      this.spherizeNormals(d, vc.pos.clone().add(new THREE.Vector3(0, -0.3, 0)));
      veilGeos.push(d);
    }

    const leavesMerged = BufferGeometryUtils.mergeGeometries(veilGeos.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 6.0, 12.5, new THREE.Color(0x367024), new THREE.Color(0x8ce044));

    return { trunk: trunkMerged, leaves: leavesMerged };
  }

  // 6. MUDA DE BÉTULA (Birch Sapling)
  public static buildBirchSapling(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Caule jovem marrom-acobreado brilhante (precisão botânica: bétula jovem NÃO tem casca branca!)
    const stemPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.06, 1.2, 0.04),
      new THREE.Vector3(-0.04, 2.2, -0.03)
    ];
    const stem = this.createCurvedTube(stemPts, 0.08, 0.04, 5, 5);
    this.applyVertexAO(stem, 0, 2.2, new THREE.Color(0x422616), new THREE.Color(0x7a4a2a));

    // Folhas romboides delicadas em verde-claro tenro
    const leaves: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const leaf = new THREE.DodecahedronGeometry(0.45, 0);
      leaf.scale(1.1, 0.4, 0.9);
      leaf.rotateZ(0.3);
      leaf.rotateY(a);
      leaf.translate(Math.cos(a) * 0.35, 1.4 + i * 0.35, Math.sin(a) * 0.35);
      leaves.push(leaf);
    }

    const leavesMerged = BufferGeometryUtils.mergeGeometries(leaves.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 1.2, 3.2, new THREE.Color(0x42681e), new THREE.Color(0xb2e848));

    return { trunk: stem, leaves: leavesMerged };
  }

  // 7. COQUEIRO ADULTO (Mature Palm)
  public static buildMaturePalm(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Tronco curvo contínuo com bulbo basal alargado
    const trunkPts: THREE.Vector3[] = [];
    const hTotal = 11.2;
    const segs = 12;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const y = t * hTotal;
      // Curvatura contínua catenária
      const x = -1.95 * Math.pow(t, 1.85);
      const z = Math.sin(t * Math.PI * 0.6) * 0.4;
      trunkPts.push(new THREE.Vector3(x, y, z));
    }
    const trunk = this.createCurvedTube(trunkPts, 0.65, 0.32, 7, segs);

    // Cachos de cocos agrupados na axila da coroa com engaços
    const coconutGeos: THREE.BufferGeometry[] = [];
    const apexPos = trunkPts[trunkPts.length - 1];
    for (let c = 0; c < 6; c++) {
      const cAngle = (c / 6) * Math.PI * 2 + 0.2;
      const coco = new THREE.DodecahedronGeometry(0.34, 1);
      coco.scale(0.85, 1.15, 0.85);
      coco.translate(
        apexPos.x + Math.cos(cAngle) * 0.45,
        apexPos.y - 0.45 + Math.sin(c * 2) * 0.1,
        apexPos.z + Math.sin(cAngle) * 0.45
      );
      coconutGeos.push(coco);
    }
    const trunkWithCocos = BufferGeometryUtils.mergeGeometries([trunk, ...coconutGeos].map(g => g.toNonIndexed()))!;
    this.applyVertexAO(trunkWithCocos, 0, 11.5, new THREE.Color(0x765434), new THREE.Color(0xb0845a));

    // Frondes tropicais em leque parabólico aberto e amplo (sem folhas espetadas para cima e sem guarda-chuva fechado)
    const frondGeos: THREE.BufferGeometry[] = [];

    // Andar superior: 7 frondes amplas fanning out horizontalmente com suave arqueamento
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.15;
      const frond = this.createCurvedFrond(5.6, 1.25, 0.70, 1.65, 8);
      frond.rotateX(0.06);
      frond.rotateY(a);
      frond.translate(apexPos.x, apexPos.y, apexPos.z);
      frondGeos.push(frond);
    }

    // Andar médio: 8 frondes adultas preenchendo a copa tropical graciosa
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.42;
      const frond = this.createCurvedFrond(6.2, 1.35, 0.45, 2.30, 8);
      frond.rotateX(0.20);
      frond.rotateY(a);
      frond.translate(apexPos.x, apexPos.y - 0.15, apexPos.z);
      frondGeos.push(frond);
    }

    // Andar inferior: 4 frondes maduras pendentes sob a coroa
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.80;
      const dryFrond = this.createCurvedFrond(4.8, 1.05, 0.20, 2.80, 7);
      dryFrond.rotateX(0.42);
      dryFrond.rotateY(a);
      dryFrond.translate(apexPos.x, apexPos.y - 0.35, apexPos.z);
      frondGeos.push(dryFrond);
    }

    const leavesMerged = BufferGeometryUtils.mergeGeometries(frondGeos.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 7.5, 12.5, new THREE.Color(0x2e6a26), new THREE.Color(0x72c83e));

    return { trunk: trunkWithCocos, leaves: leavesMerged };
  }

  // 8. MUDA DE COQUEIRO (Palm Sprout)
  public static buildPalmSprout(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Coco basal parcialmente enterrado na areia com mesocarpo fibroso
    const nut = new THREE.DodecahedronGeometry(0.42, 1);
    nut.scale(0.9, 1.2, 0.9);
    nut.rotateZ(0.3);
    nut.translate(0, 0.25, 0);
    this.applyVertexAO(nut, 0, 0.65, new THREE.Color(0x563820), new THREE.Color(0x8e623c));

    // Broto apical com 3 folhas juvenis bífidas (rabo de peixe)
    const leaves: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.2;
      const blade = this.createCurvedFrond(1.8, 0.55, 0.30, 0.55, 5);
      blade.rotateX(-0.25);
      blade.rotateY(a);
      blade.translate(0, 0.45, 0);
      leaves.push(blade);
    }

    const leavesMerged = BufferGeometryUtils.mergeGeometries(leaves.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 0.4, 2.2, new THREE.Color(0x326822), new THREE.Color(0x82dc40));

    return { trunk: nut, leaves: leavesMerged };
  }

  // 9. ACÁCIA DA SAVANA ADULTA (Mature Acacia)
  public static buildMatureAcacia(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Tronco principal angular e sinuoso que se projeta em ângulo dramático
    const trunkPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-0.3, 2.2, 0.2),
      new THREE.Vector3(-0.7, 4.4, 0.5)
    ];
    const mainStem = this.createCurvedTube(trunkPts, 0.58, 0.36, 6, 6);

    // 4 galhos mestres bifurcados criando o candelabro plano de savana
    const b1Pts = [new THREE.Vector3(-0.7, 4.4, 0.5), new THREE.Vector3(-2.2, 6.2, 0.8), new THREE.Vector3(-3.8, 7.2, 1.1)];
    const b2Pts = [new THREE.Vector3(-0.7, 4.4, 0.5), new THREE.Vector3(1.2, 6.0, -0.6), new THREE.Vector3(2.8, 7.1, -1.0)];
    const b3Pts = [new THREE.Vector3(-0.7, 4.4, 0.5), new THREE.Vector3(0.3, 6.5, 1.6), new THREE.Vector3(0.6, 7.6, 2.8)];
    const b4Pts = [new THREE.Vector3(-0.7, 4.4, 0.5), new THREE.Vector3(-0.9, 6.6, -1.4), new THREE.Vector3(-1.4, 7.5, -2.6)];

    const b1 = this.createCurvedTube(b1Pts, 0.32, 0.16, 5, 5);
    const b2 = this.createCurvedTube(b2Pts, 0.30, 0.15, 5, 5);
    const b3 = this.createCurvedTube(b3Pts, 0.26, 0.14, 5, 5);
    const b4 = this.createCurvedTube(b4Pts, 0.26, 0.14, 5, 5);

    const trunkMerged = BufferGeometryUtils.mergeGeometries([mainStem, b1, b2, b3, b4].map(g => g.toNonIndexed()))!;
    this.applyVertexAO(trunkMerged, 0, 8.0, new THREE.Color(0x765638), new THREE.Color(0xa88258));

    // Copas em múltiplos platôs tabulares horizontais (umbrella flat-topped)
    const plateGeos: THREE.BufferGeometry[] = [];
    const platePositions = [
      { pos: new THREE.Vector3(-3.6, 7.8, 1.0), r: 3.4, sY: 0.22 },
      { pos: new THREE.Vector3(2.6, 7.9, -0.9), r: 3.2, sY: 0.22 },
      { pos: new THREE.Vector3(0.5, 8.3, 2.6), r: 2.8, sY: 0.20 },
      { pos: new THREE.Vector3(-1.2, 8.2, -2.4), r: 2.7, sY: 0.20 },
      { pos: new THREE.Vector3(-0.5, 8.9, 0.2), r: 3.8, sY: 0.24 }
    ];

    for (const p of platePositions) {
      const d = new THREE.DodecahedronGeometry(p.r, 2);
      d.scale(1.35, p.sY, 1.35);
      d.translate(p.pos.x, p.pos.y, p.pos.z);
      this.spherizeNormals(d, p.pos.clone().add(new THREE.Vector3(0, -0.4, 0)));
      plateGeos.push(d);
    }

    const leavesMerged = BufferGeometryUtils.mergeGeometries(plateGeos.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 6.5, 10.0, new THREE.Color(0x3e6822), new THREE.Color(0x88c838));

    return { trunk: trunkMerged, leaves: leavesMerged };
  }

  // 10. MUDA DE ACÁCIA (Acacia Sapling)
  public static buildAcaciaSapling(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Haste fina em zigue-zague com bifurcação inicial
    const stemPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-0.1, 1.1, 0.05),
      new THREE.Vector3(0.12, 2.0, -0.04)
    ];
    const stem = this.createCurvedTube(stemPts, 0.09, 0.05, 5, 5);
    this.applyVertexAO(stem, 0, 2.0, new THREE.Color(0x3e2c1c), new THREE.Color(0x6e4e32));

    // Pequenos discos horizontais de folhas bipinadas nas bifurcações
    const plates: THREE.BufferGeometry[] = [];
    const p1 = new THREE.DodecahedronGeometry(0.85, 1);
    p1.scale(1.3, 0.22, 1.3);
    p1.translate(0.12, 2.2, -0.04);

    const p2 = new THREE.DodecahedronGeometry(0.65, 1);
    p2.scale(1.25, 0.20, 1.25);
    p2.translate(-0.35, 1.6, 0.15);

    plates.push(p1, p2);
    const leavesMerged = BufferGeometryUtils.mergeGeometries(plates.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 1.2, 2.5, new THREE.Color(0x42561e), new THREE.Color(0xabd442));

    return { trunk: stem, leaves: leavesMerged };
  }

  // 11. CACTO SAGUARO ADULTO (Mature Saguaro)
  public static buildMatureSaguaro(): { body: THREE.BufferGeometry } {
    // Coluna principal canelada (com 12 costelas/ribs reais)
    const mainStem = this.createFlutedCactusSegment(6.4, 0.48, 12, 0.07);

    // Braço esquerdo: curva em cotovelo contínua subindo verticalmente
    const a1Pts = [
      new THREE.Vector3(-0.25, 3.2, 0),
      new THREE.Vector3(-0.95, 3.3, 0),
      new THREE.Vector3(-1.45, 4.0, 0),
      new THREE.Vector3(-1.50, 5.5, 0)
    ];
    const arm1 = this.createCurvedTube(a1Pts, 0.28, 0.27, 8, 8);

    // Braço direito: curva em cotovelo mais baixa subindo verticalmente
    const a2Pts = [
      new THREE.Vector3(0.25, 2.6, 0.1),
      new THREE.Vector3(0.85, 2.7, 0.1),
      new THREE.Vector3(1.35, 3.3, 0.1),
      new THREE.Vector3(1.40, 4.6, 0.1)
    ];
    const arm2 = this.createCurvedTube(a2Pts, 0.26, 0.25, 8, 8);

    // Cúpulas apicais com leve depressão e tufos de aréolas
    const capMain = new THREE.DodecahedronGeometry(0.46, 1);
    capMain.scale(0.95, 0.75, 0.95);
    capMain.translate(0, 6.4, 0);

    const capA1 = new THREE.DodecahedronGeometry(0.27, 1);
    capA1.scale(0.95, 0.75, 0.95);
    capA1.translate(-1.50, 5.5, 0);

    const capA2 = new THREE.DodecahedronGeometry(0.25, 1);
    capA2.scale(0.95, 0.75, 0.95);
    capA2.translate(1.40, 4.6, 0.1);

    const bodyMerged = BufferGeometryUtils.mergeGeometries([mainStem, arm1, arm2, capMain, capA1, capA2].map(g => g.toNonIndexed()))!;
    this.applyVertexAO(bodyMerged, 0, 6.6, new THREE.Color(0x1e4822), new THREE.Color(0x56a848));

    return { body: bodyMerged };
  }

  // 12. MUDA DE CACTO SAGUARO (Saguaro Sprout)
  public static buildSaguaroSprout(): { body: THREE.BufferGeometry } {
    // Biologicamente exato: saguaro jovem é um corpete globoso/ovalado canelado com espinhos
    const globe = new THREE.DodecahedronGeometry(0.55, 1);
    globe.scale(0.9, 1.45, 0.9);
    globe.translate(0, 0.75, 0);

    // Tufo de espinhos apicais dourados
    const spines: THREE.BufferGeometry[] = [];
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2;
      const spine = new THREE.ConeGeometry(0.03, 0.22, 3);
      spine.rotateZ(0.45);
      spine.rotateY(a);
      spine.translate(Math.cos(a) * 0.22, 1.45, Math.sin(a) * 0.22);
      spines.push(spine);
    }

    const merged = BufferGeometryUtils.mergeGeometries([globe, ...spines].map(g => g.toNonIndexed()))!;
    this.applyVertexAO(merged, 0, 1.6, new THREE.Color(0x285626), new THREE.Color(0x6ec248));

    return { body: merged };
  }

  // 13. MANGUEZAL ADULTO (Mature Mangrove)
  public static buildMatureMangrove(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Tronco gnarled suspenso
    const trunkPts = [
      new THREE.Vector3(0, 3.4, 0),
      new THREE.Vector3(0.15, 4.5, -0.1),
      new THREE.Vector3(-0.1, 5.6, 0.15)
    ];
    const mainTrunk = this.createCurvedTube(trunkPts, 0.62, 0.44, 6, 5);

    // 6 raízes-escora em ARCOS CATENÁRIOS contínuos descendo ao solo
    const rootGeos: THREE.BufferGeometry[] = [mainTrunk];
    for (let r = 0; r < 6; r++) {
      const a = (r / 6) * Math.PI * 2 + 0.3;
      const rDist = 2.2 + (r % 2) * 0.4;
      const rPts = [
        new THREE.Vector3(0, 3.4, 0),
        new THREE.Vector3(Math.cos(a) * rDist * 0.45, 2.6, Math.sin(a) * rDist * 0.45),
        new THREE.Vector3(Math.cos(a) * rDist * 0.85, 1.2, Math.sin(a) * rDist * 0.85),
        new THREE.Vector3(Math.cos(a) * rDist, 0.0, Math.sin(a) * rDist)
      ];
      const rootArch = this.createCurvedTube(rPts, 0.26, 0.18, 5, 7);
      rootGeos.push(rootArch);
    }
    const trunkMerged = BufferGeometryUtils.mergeGeometries(rootGeos.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(trunkMerged, 0, 6.0, new THREE.Color(0x684c36), new THREE.Color(0x9a7452));

    // Copa densa tropical com propágulos pendentes estilizados
    const leafClusters: THREE.BufferGeometry[] = [];
    const clusters = [
      { pos: new THREE.Vector3(0, 7.2, 0), r: 3.5, sY: 0.85 },
      { pos: new THREE.Vector3(-1.8, 6.8, 0.9), r: 2.6, sY: 0.8 },
      { pos: new THREE.Vector3(1.7, 6.9, -0.8), r: 2.5, sY: 0.8 },
      { pos: new THREE.Vector3(0.2, 8.4, 0), r: 2.4, sY: 0.85 }
    ];

    for (const c of clusters) {
      const d = new THREE.DodecahedronGeometry(c.r, 1);
      d.scale(1.2, c.sY, 1.2);
      d.translate(c.pos.x, c.pos.y, c.pos.z);
      this.spherizeNormals(d, c.pos.clone().add(new THREE.Vector3(0, -0.4, 0)));
      leafClusters.push(d);
    }

    // 8 propágulos vivíparos pendendo da copa
    for (let p = 0; p < 8; p++) {
      const pAngle = (p / 8) * Math.PI * 2;
      const prop = new THREE.CylinderGeometry(0.04, 0.08, 1.2, 4);
      prop.translate(Math.cos(pAngle) * 2.1, 5.8 + Math.sin(p * 2) * 0.2, Math.sin(pAngle) * 2.1);
      leafClusters.push(prop);
    }

    const leavesMerged = BufferGeometryUtils.mergeGeometries(leafClusters.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 5.2, 9.5, new THREE.Color(0x2e6628), new THREE.Color(0x64b854));

    return { trunk: trunkMerged, leaves: leavesMerged };
  }

  // 14. MUDA DE MANGUEZAL (Mangrove Propagule)
  public static buildMangroveSapling(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Propágulo vivíparo autêntico: dardo lenhoso vertical cravado no lodo
    const propGeo = new THREE.CylinderGeometry(0.06, 0.12, 2.2, 5);
    propGeo.translate(0, 1.1, 0);

    // 3 radículas basais emergindo na lama
    const roots: THREE.BufferGeometry[] = [propGeo];
    for (let r = 0; r < 3; r++) {
      const a = (r / 3) * Math.PI * 2;
      const rad = new THREE.CylinderGeometry(0.03, 0.05, 0.7, 4);
      rad.rotateZ(0.5);
      rad.rotateY(a);
      rad.translate(Math.cos(a) * 0.25, 0.25, Math.sin(a) * 0.25);
      roots.push(rad);
    }
    const trunkMerged = BufferGeometryUtils.mergeGeometries(roots.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(trunkMerged, 0, 2.2, new THREE.Color(0x322214), new THREE.Color(0x5e4228));

    // 4 folhas opostas em leque ereto no topo
    const leaves: THREE.BufferGeometry[] = [];
    for (let l = 0; l < 4; l++) {
      const a = (l / 4) * Math.PI * 2;
      const blade = new THREE.DodecahedronGeometry(0.42, 0);
      blade.scale(1.2, 0.3, 0.7);
      blade.rotateZ(-0.4);
      blade.rotateY(a);
      blade.translate(Math.cos(a) * 0.28, 2.2, Math.sin(a) * 0.28);
      leaves.push(blade);
    }
    const leavesMerged = BufferGeometryUtils.mergeGeometries(leaves.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 1.8, 2.6, new THREE.Color(0x24581c), new THREE.Color(0x6ec438));

    return { trunk: trunkMerged, leaves: leavesMerged };
  }

  // 15. PINHEIRO NEVADO GLACIAL (Snow Pine)
  public static buildSnowPine(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    const pine = this.buildMaturePine();

    // Mantos de neve modelados com o mesmo perfil exato das saias de agulhas,
    // assentados DIRETAMENTE sobre as copas com offset normal microscópico (+0.02m)
    // para abraçar as acículas sem nenhum vão de ar (zero floating gap)
    const snowCaps: THREE.BufferGeometry[] = [];
    const tiers = [
      { y: 5.5, r: 3.8, h: 3.5, tips: 9 },
      { y: 8.2, r: 3.1, h: 3.2, tips: 8 },
      { y: 10.8, r: 2.4, h: 2.9, tips: 7 },
      { y: 13.0, r: 1.7, h: 2.6, tips: 6 },
      { y: 14.8, r: 0.95, h: 2.2, tips: 5 }
    ];

    for (const t of tiers) {
      // Saia de neve com a mesma curvatura e verticilos da folhagem
      const snowBlanket = this.createConiferSkirt(t.r * 1.015, t.h, t.tips, 0.35, 0.22);
      // Encurta ligeiramente a borda inferior para deixar as pontas das agulhas verdes expostas
      const pos = snowBlanket.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const rimThreshold = -t.h / 2 + 0.32;
        if (y < rimThreshold) {
          pos.setY(i, y + 0.38);
          pos.setX(i, pos.getX(i) * 0.93);
          pos.setZ(i, pos.getZ(i) * 0.93);
        }
      }
      snowBlanket.computeVertexNormals();
      snowBlanket.translate(0, t.y + 0.02, 0);
      snowCaps.push(snowBlanket);
    }

    // Topo de neve assentado diretamente sobre o ápice
    const apexSnow = new THREE.ConeGeometry(0.46, 1.42, 5);
    apexSnow.translate(0, 16.02, 0);
    snowCaps.push(apexSnow);

    const snowMerged = BufferGeometryUtils.mergeGeometries(snowCaps.map(g => g.toNonIndexed()))!;
    // Gradiente de neve pura no topo para azul-geada na sombra de contato
    this.applyVertexAO(snowMerged, 5.0, 16.5, new THREE.Color(0xd2eaf8), new THREE.Color(0xffffff));

    const combinedLeaves = BufferGeometryUtils.mergeGeometries([pine.leaves, snowMerged].map(g => g.toNonIndexed()))!;
    return { trunk: pine.trunk, leaves: combinedLeaves };
  }

  // 16. SALGUEIRO-ANÃO DA TUNDRA (Arctic Willow - Salix arctica)
  public static buildArcticWillow(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    // Morfologia prostrada rente ao permafrost (hábito rasteiro verdadeiro)
    const stemGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.2;
      const sPts = [
        new THREE.Vector3(0, 0.05, 0),
        new THREE.Vector3(Math.cos(a) * 0.6, 0.12, Math.sin(a) * 0.6),
        new THREE.Vector3(Math.cos(a) * 1.3, 0.18, Math.sin(a) * 1.3)
      ];
      const s = this.createCurvedTube(sPts, 0.14, 0.08, 4, 4);
      stemGeos.push(s);
    }
    const trunkMerged = BufferGeometryUtils.mergeGeometries(stemGeos.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(trunkMerged, 0, 0.25, new THREE.Color(0x281c14), new THREE.Color(0x4a3626));

    // Almofadas foliares rasteiras com amentilhos (flores peludas avermelhadas)
    const cushions: THREE.BufferGeometry[] = [];
    for (let c = 0; c < 5; c++) {
      const a = (c / 5) * Math.PI * 2;
      const cushion = new THREE.DodecahedronGeometry(0.75, 1);
      cushion.scale(1.4, 0.45, 1.4);
      cushion.translate(Math.cos(a) * 0.85, 0.45, Math.sin(a) * 0.85);
      cushions.push(cushion);
    }

    // 8 amentilhos polares eretos
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.4;
      const catkin = new THREE.ConeGeometry(0.08, 0.35, 4);
      catkin.translate(Math.cos(a) * 0.95, 0.75, Math.sin(a) * 0.95);
      cushions.push(catkin);
    }

    const leavesMerged = BufferGeometryUtils.mergeGeometries(cushions.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 0.1, 0.9, new THREE.Color(0x324a30), new THREE.Color(0x76a872));

    return { trunk: trunkMerged, leaves: leavesMerged };
  }

  // 17. ÁRVORE CALCINADA VULCÂNICA (Burnt Tree)
  public static buildBurntTree(): { body: THREE.BufferGeometry } {
    // Tronco oco estilhaçado com pontas afiadas
    const trunkBase = this.createButtressTrunk(4.6, 0.65, 0.25, 4, 0.25, 7, 7);

    // Lascas quebradas pontiagudas no topo
    const shards: THREE.BufferGeometry[] = [trunkBase];
    for (let s = 0; s < 4; s++) {
      const a = (s / 4) * Math.PI * 2;
      const shard = new THREE.ConeGeometry(0.12, 0.9, 3);
      shard.translate(Math.cos(a) * 0.18, 4.8, Math.sin(a) * 0.18);
      shards.push(shard);
    }

    // Toco quebrado de galho lateral
    const bPts = [new THREE.Vector3(0, 3.2, 0), new THREE.Vector3(-0.7, 3.9, 0.2)];
    const branch = this.createCurvedTube(bPts, 0.22, 0.12, 4, 3);
    shards.push(branch);

    // Núcleo de brasa interna incandescente (laranja/vermelho)
    const ember = new THREE.CylinderGeometry(0.08, 0.14, 2.2, 4).toNonIndexed();
    ember.translate(0, 2.2, 0);
    const emberColor = new THREE.Color(0xff4500);
    const emberColors = new Float32Array(ember.attributes.position.count * 3);
    for (let i = 0; i < ember.attributes.position.count; i++) {
      emberColors[i * 3] = emberColor.r;
      emberColors[i * 3 + 1] = emberColor.g;
      emberColors[i * 3 + 2] = emberColor.b;
    }
    ember.setAttribute('color', new THREE.BufferAttribute(emberColors, 3));

    const trunkMerged = BufferGeometryUtils.mergeGeometries(shards.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(trunkMerged, 0, 5.2, new THREE.Color(0x141414), new THREE.Color(0x353535));

    const fullTree = BufferGeometryUtils.mergeGeometries([trunkMerged, ember])!;
    return { body: fullTree };
  }

  // 18. ARBUSTO EXUBERANTE DA FLORESTA (Lush Shrub)
  public static buildLushShrub(): { body: THREE.BufferGeometry } {
    // Pequenos caules lenhosos basais ramificados
    const stemGeos: THREE.BufferGeometry[] = [];
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * Math.PI * 2;
      const stem = new THREE.CylinderGeometry(0.06, 0.10, 0.7, 4);
      stem.rotateZ(0.35);
      stem.rotateY(a);
      stem.translate(Math.cos(a) * 0.2, 0.35, Math.sin(a) * 0.2);
      stemGeos.push(stem);
    }
    const stems = BufferGeometryUtils.mergeGeometries(stemGeos.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(stems, 0, 0.7, new THREE.Color(0x2e1e12), new THREE.Color(0x563820));

    // Folhagem estratificada com normais esferizadas
    const leafClusters: THREE.BufferGeometry[] = [];
    const positions = [
      { pos: new THREE.Vector3(0, 0.85, 0), r: 0.95, sY: 0.8 },
      { pos: new THREE.Vector3(-0.6, 0.65, 0.35), r: 0.75, sY: 0.75 },
      { pos: new THREE.Vector3(0.55, 0.62, -0.3), r: 0.72, sY: 0.75 },
      { pos: new THREE.Vector3(0.1, 0.68, 0.6), r: 0.68, sY: 0.75 }
    ];

    for (const p of positions) {
      const d = new THREE.DodecahedronGeometry(p.r, 1);
      d.scale(1.15, p.sY, 1.15);
      d.translate(p.pos.x, p.pos.y, p.pos.z);
      this.spherizeNormals(d, p.pos.clone().add(new THREE.Vector3(0, -0.3, 0)));
      leafClusters.push(d);
    }

    const foliageMerged = BufferGeometryUtils.mergeGeometries(leafClusters.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(foliageMerged, 0.3, 1.5, new THREE.Color(0x1a4214), new THREE.Color(0x6ec238));

    const completeShrub = BufferGeometryUtils.mergeGeometries([stems, foliageMerged])!;
    return { body: completeShrub };
  }

  // 19. ARBUSTO COM BAGAS SILVESTRES (Berry Bush)
  public static buildBerryBush(): { body: THREE.BufferGeometry } {
    const baseShrub = this.buildLushShrub();

    // Bagas volumosas e proeminentes posicionadas na superfície externa superior e flancos visíveis
    const berries: THREE.BufferGeometry[] = [];

    // Coordenadas orgânicas precisamente posicionadas na casca externa dos domos foliares (y entre 0.95m e 1.48m)
    const berryPositions = [
      // Cúpula central (ápice e flancos superiores)
      { x: 0.28, y: 1.45, z: 0.25 },
      { x: -0.22, y: 1.48, z: 0.20 },
      { x: 0.05, y: 1.52, z: -0.15 },
      { x: 0.52, y: 1.32, z: 0.32 },
      { x: -0.45, y: 1.30, z: 0.40 },
      { x: 0.15, y: 1.38, z: 0.65 },
      { x: -0.20, y: 1.36, z: -0.55 },

      // Lobo esquerdo visível (flanco anterior superior)
      { x: -0.88, y: 1.15, z: 0.45 },
      { x: -0.72, y: 1.25, z: 0.62 },
      { x: -0.82, y: 1.05, z: 0.80 },
      { x: -1.02, y: 0.98, z: 0.25 },

      // Lobo direito visível (flanco anterior superior)
      { x: 0.85, y: 1.12, z: -0.20 },
      { x: 0.70, y: 1.22, z: 0.15 },
      { x: 0.92, y: 1.02, z: 0.25 },
      { x: 0.75, y: 1.18, z: -0.55 },

      // Lobo frontal central
      { x: 0.12, y: 1.18, z: 1.05 },
      { x: -0.18, y: 1.12, z: 1.02 },
      { x: 0.30, y: 1.05, z: 0.95 },
      { x: -0.05, y: 1.25, z: 0.90 }
    ];

    let bIdx = 0;
    for (const bp of berryPositions) {
      const rBerry = 0.13 + (bIdx % 3) * 0.02;
      const bGeo = new THREE.DodecahedronGeometry(rBerry, 1).toNonIndexed();
      bGeo.translate(bp.x, bp.y, bp.z);

      // Mapeamento UV forçado para o quadrante das bagas na textura (U >= 0.88, V >= 0.88)
      // Garante brilho carmesim/rubi lustroso puro com highlight sem escurecimento
      const pos = bGeo.attributes.position;
      const uvs = new Float32Array(pos.count * 2);
      const cols = new Float32Array(pos.count * 3);

      const colorVariant = bIdx % 3;
      const berryCol = colorVariant === 0 ? new THREE.Color(0xff2a5e) : // Rubi brilhante
                       colorVariant === 1 ? new THREE.Color(0xdc143c) : // Carmesim
                                            new THREE.Color(0x9e0832);  // Cereja madura profunda

      for (let i = 0; i < pos.count; i++) {
        // Mapeia para o centro do patch de baga da textura
        uvs[i * 2] = 0.93;
        uvs[i * 2 + 1] = 0.93;

        cols[i * 3] = berryCol.r;
        cols[i * 3 + 1] = berryCol.g;
        cols[i * 3 + 2] = berryCol.b;
      }

      bGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      bGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      berries.push(bGeo);
      bIdx++;
    }

    const completeBush = BufferGeometryUtils.mergeGeometries([baseShrub.body, ...berries].map(g => g.toNonIndexed()))!;
    return { body: completeBush };
  }

  // =========================================================================
  // 20. VARIAÇÃO DE ROCHAS AMBIENTAIS (5 Formatos Distintos)
  // =========================================================================

  /**
   * Bloco granítico erodido e arredondado com base assentada e pátina de líquen no topo.
   */
  public static buildWeatheredBoulder(): { body: THREE.BufferGeometry } {
    let geo: THREE.BufferGeometry = new THREE.DodecahedronGeometry(1.3, 2);
    geo.scale(1.22, 0.78, 1.10);

    // Assentamento da base para repousar solidamente no solo
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < -0.45) {
        pos.setY(i, -0.45);
      }
    }
    const smoothGeo = BufferGeometryUtils.mergeVertices(geo);
    smoothGeo.computeVertexNormals();
    smoothGeo.translate(0, 0.45, 0);

    const sPos = smoothGeo.attributes.position;
    const cols = new Float32Array(sPos.count * 3);
    const normals = smoothGeo.attributes.normal;
    for (let i = 0; i < sPos.count; i++) {
      const y = sPos.getY(i);
      const ny = normals.getY(i);
      const tH = Math.min(1, Math.max(0, y / 1.0));
      const c = new THREE.Color(0x6e7378).lerp(new THREE.Color(0x8a9299), tH);
      if (ny > 0.55 && y > 0.35) {
        c.lerp(new THREE.Color(0x768f56), (ny - 0.55) * 1.4);
      }
      if (y < 0.22) {
        c.lerp(new THREE.Color(0x36383c), (0.22 - y) / 0.22);
      }
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    smoothGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return { body: smoothGeo };
  }

  /**
   * Laje angulada de crag/ardósia com planos de clivagem estratificados e fraturas poligonais.
   */
  public static buildSharpSlate(): { body: THREE.BufferGeometry } {
    const geo = new THREE.CylinderGeometry(0.75, 1.45, 0.85, 6, 1, false).toNonIndexed();
    geo.scale(1.40, 0.90, 0.85);
    geo.rotateZ(0.25);
    geo.rotateX(-0.18);
    geo.translate(0, 0.38, 0);

    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const tH = Math.min(1, Math.max(0, (y - 0.05) / 0.85));
      const strata = Math.sin(y * 14.0) * 0.15;
      const c = new THREE.Color(0x4c525c).lerp(new THREE.Color(0x8e97a4), Math.min(1, Math.max(0, tH + strata)));
      if (y < 0.22) {
        c.lerp(new THREE.Color(0x282a2e), (0.22 - y) / 0.22);
      }
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    return { body: geo };
  }

  /**
   * Cacho orgânico de 5 seixos rolados de rio ou praia agrupados naturalmente.
   */
  public static buildPebbleCluster(): { body: THREE.BufferGeometry } {
    const stones: THREE.BufferGeometry[] = [];
    const specs = [
      { r: 0.50, sx: 1.25, sy: 0.65, sz: 1.05, x: -0.15, y: 0.25, z: 0.10, rotY: 0.4, col: 0x7a8088 },
      { r: 0.38, sx: 1.10, sy: 0.58, sz: 1.30, x: 0.38, y: 0.18, z: -0.12, rotY: 1.8, col: 0x8c867a },
      { r: 0.30, sx: 1.15, sy: 0.60, sz: 0.90, x: 0.08, y: 0.14, z: 0.42, rotY: 2.7, col: 0x6e747c },
      { r: 0.24, sx: 1.00, sy: 0.55, sz: 1.10, x: -0.42, y: 0.12, z: -0.28, rotY: 0.9, col: 0x909498 },
      { r: 0.18, sx: 1.05, sy: 0.50, sz: 1.00, x: 0.45, y: 0.09, z: 0.35, rotY: 1.2, col: 0x767064 }
    ];

    for (const s of specs) {
      let pGeo: THREE.BufferGeometry = new THREE.DodecahedronGeometry(s.r, 2);
      pGeo.scale(s.sx, s.sy, s.sz);
      pGeo.rotateY(s.rotY);
      pGeo.translate(s.x, s.y, s.z);
      pGeo = BufferGeometryUtils.mergeVertices(pGeo);
      pGeo.computeVertexNormals();

      const pos = pGeo.attributes.position;
      const cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const baseC = new THREE.Color(s.col);
        if (y < 0.12) {
          baseC.lerp(new THREE.Color(0x323438), (0.12 - y) / 0.12);
        }
        cols[i * 3] = baseC.r;
        cols[i * 3 + 1] = baseC.g;
        cols[i * 3 + 2] = baseC.b;
      }
      pGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      stones.push(pGeo);
    }

    const merged = BufferGeometryUtils.mergeGeometries(stones.map(g => g.toNonIndexed()))!;
    return { body: merged };
  }

  /**
   * Coluna basáltica hexagonal esculpida com degraus em patamares.
   */
  public static buildRockSpire(): { body: THREE.BufferGeometry } {
    const pillars: THREE.BufferGeometry[] = [];
    const pSpecs = [
      { r: 0.58, h: 3.8, x: 0, z: 0, rotY: 0.2 },
      { r: 0.44, h: 2.6, x: 0.65, z: 0.25, rotY: 0.7 },
      { r: 0.38, h: 1.7, x: -0.35, z: 0.55, rotY: 1.1 }
    ];

    for (const ps of pSpecs) {
      const p = new THREE.CylinderGeometry(ps.r * 0.88, ps.r, ps.h, 6, 4, false).toNonIndexed();
      p.translate(ps.x, ps.h / 2, ps.z);
      pillars.push(p);

      const cap = new THREE.ConeGeometry(ps.r * 0.88, 0.4, 6).toNonIndexed();
      cap.translate(ps.x, ps.h + 0.15, ps.z);
      pillars.push(cap);
    }

    const merged = BufferGeometryUtils.mergeGeometries(pillars.map(g => g.toNonIndexed()))!;
    const pos = merged.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const tH = Math.min(1, Math.max(0, y / 4.0));
      const c = new THREE.Color(0x32353a).lerp(new THREE.Color(0x70757d), tH);
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    merged.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    merged.computeVertexNormals();
    return { body: merged };
  }

  /**
   * Pedra de floresta com espessa camada de musgo aveludado verde no topo.
   */
  public static buildMossyRock(): { body: THREE.BufferGeometry } {
    const boulder = this.buildWeatheredBoulder().body;

    let mossCap: THREE.BufferGeometry = new THREE.DodecahedronGeometry(1.30, 2);
    mossCap.scale(1.24, 0.70, 1.12);
    mossCap = BufferGeometryUtils.mergeVertices(mossCap);
    mossCap.computeVertexNormals();
    mossCap.translate(0, 0.54, 0);

    const pos = mossCap.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      // Mapeia para o centro do patch de musgo esmeralda da textura de rocha
      uvs[i * 2] = 0.88;
      uvs[i * 2 + 1] = 0.88;

      const c = new THREE.Color(0x389a20).lerp(new THREE.Color(0x86e838), Math.min(1, Math.max(0, (y - 0.2) / 0.8)));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    mossCap.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    mossCap.setAttribute('color', new THREE.BufferAttribute(cols, 3));

    const merged = BufferGeometryUtils.mergeGeometries([boulder, mossCap].map(g => g.toNonIndexed()))!;
    return { body: merged };
  }

  // =========================================================================
  // 21. VARIAÇÃO DE MADEIRA E TRONCOS CAÍDOS (4 Formatos)
  // =========================================================================

  /**
   * Tronco oco apodrecido com extremidades estilhaçadas e cavidade interna escura.
   */
  public static buildHollowLog(): { body: THREE.BufferGeometry } {
    const len = 4.8;
    const rOuter = 0.44;
    const rInner = 0.28;
    const segs = 7;

    const outer = new THREE.CylinderGeometry(rOuter * 0.92, rOuter, len, segs, 4, true).toNonIndexed();
    outer.rotateZ(Math.PI / 2);
    outer.translate(0, rOuter, 0);

    const inner = new THREE.CylinderGeometry(rInner * 0.92, rInner, len - 0.2, segs, 4, true).toNonIndexed();
    inner.rotateZ(Math.PI / 2);
    inner.scale(-1, 1, 1);
    inner.translate(0, rOuter, 0);

    const shards: THREE.BufferGeometry[] = [outer, inner];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const sLen = 0.35 + (i % 3) * 0.18;
      const shard = new THREE.ConeGeometry(0.09, sLen, 3).toNonIndexed();
      shard.rotateZ(-Math.PI / 2);
      shard.translate(len / 2 + sLen / 2, rOuter + Math.cos(a) * (rOuter - 0.05), Math.sin(a) * (rOuter - 0.05));
      shards.push(shard);
    }

    const merged = BufferGeometryUtils.mergeGeometries(shards.map(g => g.toNonIndexed()))!;
    const pos = merged.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const rad = Math.sqrt(Math.pow(y - rOuter, 2) + Math.pow(pos.getZ(i), 2));
      const isInner = rad < rInner + 0.06;
      const c = isInner ? new THREE.Color(0x22160d) : new THREE.Color(0x564230).lerp(new THREE.Color(0x725a44), y / (rOuter * 2));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    merged.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    merged.computeVertexNormals();
    return { body: merged };
  }

  /**
   * Tronco arrancado com raiz exposta e bifurcação de galho.
   */
  public static buildRootedLog(): { body: THREE.BufferGeometry } {
    const trunkPts = [
      new THREE.Vector3(-2.2, 0.45, 0),
      new THREE.Vector3(0, 0.40, 0.15),
      new THREE.Vector3(2.4, 0.32, -0.1)
    ];
    const stem = this.createCurvedTube(trunkPts, 0.52, 0.28, 6, 6);

    const rootGeos: THREE.BufferGeometry[] = [stem];
    const r1Pts = [new THREE.Vector3(-2.2, 0.45, 0), new THREE.Vector3(-2.7, 0.85, 0.35), new THREE.Vector3(-3.1, 0.95, 0.5)];
    const r2Pts = [new THREE.Vector3(-2.2, 0.45, 0), new THREE.Vector3(-2.8, 0.20, -0.45), new THREE.Vector3(-3.3, 0.12, -0.6)];
    const r3Pts = [new THREE.Vector3(-2.2, 0.45, 0), new THREE.Vector3(-2.6, 1.05, -0.2), new THREE.Vector3(-2.9, 1.25, -0.3)];
    rootGeos.push(this.createCurvedTube(r1Pts, 0.24, 0.09, 4, 4));
    rootGeos.push(this.createCurvedTube(r2Pts, 0.26, 0.11, 4, 4));
    rootGeos.push(this.createCurvedTube(r3Pts, 0.20, 0.08, 4, 4));

    const bPts = [new THREE.Vector3(0.8, 0.38, 0.1), new THREE.Vector3(1.4, 1.2, 0.55)];
    rootGeos.push(this.createCurvedTube(bPts, 0.22, 0.10, 4, 4));

    const merged = BufferGeometryUtils.mergeGeometries(rootGeos.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(merged, 0, 1.3, new THREE.Color(0x342214), new THREE.Color(0x6a503a));
    return { body: merged };
  }

  /**
   * Toco de árvore antigo enraizado no solo com anéis de crescimento e fungo orelha-de-pau.
   */
  public static buildTreeStump(): { body: THREE.BufferGeometry } {
    const stump = this.createButtressTrunk(1.15, 0.74, 0.48, 4, 0.28, 7, 5);
    const topCap = new THREE.CylinderGeometry(0.48, 0.48, 0.06, 7).toNonIndexed();
    topCap.translate(0, 1.15, 0);

    // Mapeia o platô superior cortado para os anéis de crescimento da textura de madeira
    const posCap = topCap.attributes.position;
    const uvsCap = new Float32Array(posCap.count * 2);
    for (let i = 0; i < posCap.count; i++) {
      // Centro dos anéis em (0.25, 0.25)
      uvsCap[i * 2] = 0.25 + (posCap.getX(i) / 0.48) * 0.18;
      uvsCap[i * 2 + 1] = 0.25 + (posCap.getZ(i) / 0.48) * 0.18;
    }
    topCap.setAttribute('uv', new THREE.BufferAttribute(uvsCap, 2));

    // Estrutura lenhosa básica (toco, platô com anéis e raízes)
    const woodParts: THREE.BufferGeometry[] = [stump, topCap];
    const rootAngles = [0.4, 1.9, 3.6, 5.1];
    for (const rAng of rootAngles) {
      const rPts = [
        new THREE.Vector3(Math.cos(rAng) * 0.45, 0.35, Math.sin(rAng) * 0.45),
        new THREE.Vector3(Math.cos(rAng) * 0.95, 0.08, Math.sin(rAng) * 0.95)
      ];
      const rTube = this.createCurvedTube(rPts, 0.22, 0.09, 4, 3);
      woodParts.push(rTube);
    }

    const woodMerged = BufferGeometryUtils.mergeGeometries(woodParts.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(woodMerged, 0, 1.25, new THREE.Color(0x2a1a10), new THREE.Color(0x72543c));

    // Cogumelos orelha-de-pau (bracket fungus) escalonados no flanco do tronco
    const allPieces: THREE.BufferGeometry[] = [woodMerged];
    for (let f = 0; f < 2; f++) {
      const fungus = new THREE.DodecahedronGeometry(0.24 - f * 0.06, 0).toNonIndexed();
      fungus.scale(1.4, 0.18, 1.0);
      fungus.translate(0.54 - f * 0.04, 0.72 + f * 0.22, 0.08);
      const posF = fungus.attributes.position;
      const colF = new Float32Array(posF.count * 3);
      for (let i = 0; i < posF.count; i++) {
        const fc = new THREE.Color(0xb86024).lerp(new THREE.Color(0xf0a84e), (posF.getX(i) - 0.4) / 0.3);
        colF[i * 3] = fc.r;
        colF[i * 3 + 1] = fc.g;
        colF[i * 3 + 2] = fc.b;
      }
      fungus.setAttribute('color', new THREE.BufferAttribute(colF, 3));
      allPieces.push(fungus);
    }

    const completeStump = BufferGeometryUtils.mergeGeometries(allPieces.map(g => g.toNonIndexed()))!;
    return { body: completeStump };
  }

  // =========================================================================
  // 22. VARIANTE ARBÓREA E SUB-BOSQUE
  // =========================================================================

  /**
   * Bétula de tronco duplo: dois fustes esguios divergentes emergindo da mesma raiz.
   */
  public static buildTwinBirch(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    const t1Pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-0.4, 3.5, 0.2),
      new THREE.Vector3(-1.1, 7.5, 0.4),
      new THREE.Vector3(-1.5, 10.5, 0.5)
    ];
    const t2Pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.5, 3.0, -0.2),
      new THREE.Vector3(1.2, 6.2, -0.3),
      new THREE.Vector3(1.6, 8.8, -0.4)
    ];
    const trunk1 = this.createCurvedTube(t1Pts, 0.36, 0.16, 6, 8);
    const trunk2 = this.createCurvedTube(t2Pts, 0.32, 0.14, 6, 8);
    const trunkMerged = BufferGeometryUtils.mergeGeometries([trunk1, trunk2].map(g => g.toNonIndexed()))!;
    this.applyVertexAO(trunkMerged, 0, 11.0, new THREE.Color(0xd0d0cc), new THREE.Color(0xffffff));

    const leafClouds: THREE.BufferGeometry[] = [];
    const apexes = [
      { center: new THREE.Vector3(-1.5, 10.2, 0.5), r: 2.2, sY: 1.4 },
      { center: new THREE.Vector3(-1.2, 8.5, 0.3), r: 1.8, sY: 1.2 },
      { center: new THREE.Vector3(1.6, 8.6, -0.4), r: 1.9, sY: 1.3 },
      { center: new THREE.Vector3(1.3, 7.0, -0.2), r: 1.6, sY: 1.1 }
    ];

    for (const c of apexes) {
      const d = new THREE.DodecahedronGeometry(c.r, 1).toNonIndexed();
      d.scale(1.0, c.sY, 1.0);
      d.translate(c.center.x, c.center.y, c.center.z);
      this.spherizeNormals(d, c.center.clone().add(new THREE.Vector3(0, -0.3, 0)));
      leafClouds.push(d);
    }
    const leavesMerged = BufferGeometryUtils.mergeGeometries(leafClouds.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 5.5, 12.0, new THREE.Color(0x355a1e), new THREE.Color(0x9adb3a));
    return { trunk: trunkMerged, leaves: leavesMerged };
  }

  /**
   * Carvalho de copa ampla e assimétrica: tronco espesso com ramo lateral proeminente.
   */
  public static buildBroadOak(): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
    const trunkBase = this.createButtressTrunk(4.5, 1.15, 0.55, 4, 0.38, 8, 5);
    const mainBranch = [new THREE.Vector3(0, 4.0, 0), new THREE.Vector3(2.2, 5.2, -0.4), new THREE.Vector3(4.2, 5.8, -0.8)];
    const leftBranch = [new THREE.Vector3(0, 4.0, 0), new THREE.Vector3(-1.8, 5.6, 0.6), new THREE.Vector3(-3.2, 6.4, 1.0)];
    const topStem = [new THREE.Vector3(0, 4.0, 0), new THREE.Vector3(-0.2, 6.5, 0.1), new THREE.Vector3(0.3, 8.2, 0.2)];

    const b1 = this.createCurvedTube(mainBranch, 0.42, 0.22, 5, 5);
    const b2 = this.createCurvedTube(leftBranch, 0.38, 0.18, 5, 5);
    const b3 = this.createCurvedTube(topStem, 0.40, 0.20, 5, 5);
    const trunkMerged = BufferGeometryUtils.mergeGeometries([trunkBase, b1, b2, b3].map(g => g.toNonIndexed()))!;
    this.applyVertexAO(trunkMerged, 0, 8.5, new THREE.Color(0x724e36), new THREE.Color(0xa47a54));

    const canopies: THREE.BufferGeometry[] = [];
    const clusters = [
      { pos: new THREE.Vector3(0.3, 8.4, 0.2), r: 3.2, sY: 0.75 },
      { pos: new THREE.Vector3(4.2, 6.0, -0.8), r: 2.8, sY: 0.70 },
      { pos: new THREE.Vector3(-3.2, 6.6, 1.0), r: 2.6, sY: 0.70 },
      { pos: new THREE.Vector3(1.8, 7.2, 1.6), r: 2.2, sY: 0.75 },
      { pos: new THREE.Vector3(-1.2, 7.0, -1.8), r: 2.2, sY: 0.75 }
    ];

    for (const cl of clusters) {
      const d = new THREE.DodecahedronGeometry(cl.r, 1).toNonIndexed();
      d.scale(1.15, cl.sY, 1.15);
      d.translate(cl.pos.x, cl.pos.y, cl.pos.z);
      this.spherizeNormals(d, cl.pos.clone().add(new THREE.Vector3(0, -0.4, 0)));
      canopies.push(d);
    }
    const leavesMerged = BufferGeometryUtils.mergeGeometries(canopies.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(leavesMerged, 4.5, 10.5, new THREE.Color(0x326822), new THREE.Color(0x82d43e));
    return { trunk: trunkMerged, leaves: leavesMerged };
  }

  /**
   * Samambaia de sub-bosque em taça/shuttlecock com frondes arqueadas e brotos eretos.
   */
  public static buildForestFern(): { body: THREE.BufferGeometry } {
    const fronds: THREE.BufferGeometry[] = [];
    // 8 frondes adultas externas abertas em taça elegante
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.15;
      const frond = this.createCurvedFrond(1.85, 0.60, 0.52, 0.85, 6).toNonIndexed();
      frond.rotateX(0.48);
      frond.rotateY(a);
      frond.translate(0, 0.12, 0);
      fronds.push(frond);
    }
    // 4 frondes juvenis internas mais eretas e esguias
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.55;
      const youngFrond = this.createCurvedFrond(1.35, 0.44, 0.28, 0.72, 5).toNonIndexed();
      youngFrond.rotateX(0.24);
      youngFrond.rotateY(a);
      youngFrond.translate(0, 0.18, 0);
      fronds.push(youngFrond);
    }
    const merged = BufferGeometryUtils.mergeGeometries(fronds.map(g => g.toNonIndexed()))!;
    this.applyVertexAO(merged, 0, 1.15, new THREE.Color(0x164214), new THREE.Color(0x6ad438));
    return { body: merged };
  }

  /**
   * Cacho de flores campestres com roseta basal, hastes delgadas e corolas vivas multicoloridas.
   */
  public static buildWildflowers(): { body: THREE.BufferGeometry } {
    const parts: THREE.BufferGeometry[] = [];

    // Roseta de folhas basais verdes no solo
    for (let b = 0; b < 6; b++) {
      const a = (b / 6) * Math.PI * 2;
      const leaf = new THREE.ConeGeometry(0.12, 0.35, 3).toNonIndexed();
      leaf.rotateX(Math.PI / 2.3);
      leaf.rotateY(a);
      leaf.translate(Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15);
      const posL = leaf.attributes.position;
      const colL = new Float32Array(posL.count * 3);
      for (let i = 0; i < posL.count; i++) {
        colL[i * 3] = 0.18;
        colL[i * 3 + 1] = 0.52;
        colL[i * 3 + 2] = 0.14;
      }
      leaf.setAttribute('color', new THREE.BufferAttribute(colL, 3));
      parts.push(leaf);
    }

    const flowerAnchors = [
      { x: 0.14, z: 0.10, h: 0.52, petalCol: 0xffe033, centerCol: 0x8a5200 }, // Dente-de-leão / margarida amarela
      { x: -0.16, z: 0.15, h: 0.62, petalCol: 0xff2a48, centerCol: 0x220505 }, // Papoula carmesim
      { x: 0.05, z: -0.18, h: 0.48, petalCol: 0x3882f6, centerCol: 0xffffff }, // Flor azul alpina
      { x: 0.25, z: -0.12, h: 0.58, petalCol: 0xb048f8, centerCol: 0xffea55 }, // Violeta campestre
      { x: -0.22, z: -0.16, h: 0.46, petalCol: 0xff2a48, centerCol: 0x220505 }, // Papoula carmesim
      { x: 0.18, z: 0.25, h: 0.44, petalCol: 0xffe033, centerCol: 0x8a5200 }, // Margarida dourada
      { x: -0.05, z: 0.28, h: 0.55, petalCol: 0x3882f6, centerCol: 0xffffff }  // Miosótis azul
    ];

    for (const f of flowerAnchors) {
      // Haste verde graciosa
      const stem = new THREE.CylinderGeometry(0.016, 0.022, f.h, 4).toNonIndexed();
      stem.translate(f.x, f.h / 2, f.z);
      const posStem = stem.attributes.position;
      const colStem = new Float32Array(posStem.count * 3);
      for (let i = 0; i < posStem.count; i++) {
        colStem[i * 3] = 0.24;
        colStem[i * 3 + 1] = 0.60;
        colStem[i * 3 + 2] = 0.18;
      }
      stem.setAttribute('color', new THREE.BufferAttribute(colStem, 3));
      parts.push(stem);

      // Corola de pétalas (estrela facetada em disco)
      const petals = new THREE.CylinderGeometry(0.12, 0.06, 0.04, 5).toNonIndexed();
      petals.translate(f.x, f.h + 0.02, f.z);
      const pCol = new THREE.Color(f.petalCol);
      const posPetals = petals.attributes.position;
      const colPetals = new Float32Array(posPetals.count * 3);
      for (let i = 0; i < posPetals.count; i++) {
        colPetals[i * 3] = pCol.r;
        colPetals[i * 3 + 1] = pCol.g;
        colPetals[i * 3 + 2] = pCol.b;
      }
      petals.setAttribute('color', new THREE.BufferAttribute(colPetals, 3));
      parts.push(petals);

      // Miolo central contrastante
      const center = new THREE.DodecahedronGeometry(0.04, 0).toNonIndexed();
      center.translate(f.x, f.h + 0.04, f.z);
      const cCol = new THREE.Color(f.centerCol);
      const posC = center.attributes.position;
      const colC = new Float32Array(posC.count * 3);
      for (let i = 0; i < posC.count; i++) {
        colC[i * 3] = cCol.r;
        colC[i * 3 + 1] = cCol.g;
        colC[i * 3 + 2] = cCol.b;
      }
      center.setAttribute('color', new THREE.BufferAttribute(colC, 3));
      parts.push(center);
    }

    const merged = BufferGeometryUtils.mergeGeometries(parts.map(g => g.toNonIndexed()))!;
    return { body: merged };
  }

  /**
   * Cacho de juncos / taboas aquáticas de margem.
   */
  public static buildReeds(): { body: THREE.BufferGeometry } {
    const reeds: THREE.BufferGeometry[] = [];
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      const dist = 0.15 + (r % 3) * 0.10;
      const x = Math.cos(a) * dist;
      const z = Math.sin(a) * dist;
      const h = 1.9 + (r % 4) * 0.28;

      const stalk = new THREE.CylinderGeometry(0.02, 0.035, h, 3).toNonIndexed();
      stalk.translate(x, h / 2, z);
      const posS = stalk.attributes.position;
      const colS = new Float32Array(posS.count * 3);
      for (let i = 0; i < posS.count; i++) {
        colS[i * 3] = 0.38;
        colS[i * 3 + 1] = 0.62;
        colS[i * 3 + 2] = 0.24;
      }
      stalk.setAttribute('color', new THREE.BufferAttribute(colS, 3));
      reeds.push(stalk);

      if (r % 2 === 0) {
        const spike = new THREE.CylinderGeometry(0.045, 0.045, 0.40, 4).toNonIndexed();
        spike.translate(x, h - 0.25, z);
        const posSp = spike.attributes.position;
        const colSp = new Float32Array(posSp.count * 3);
        for (let i = 0; i < posSp.count; i++) {
          colSp[i * 3] = 0.32;
          colSp[i * 3 + 1] = 0.18;
          colSp[i * 3 + 2] = 0.10;
        }
        spike.setAttribute('color', new THREE.BufferAttribute(colSp, 3));
        reeds.push(spike);
      }
    }

    const merged = BufferGeometryUtils.mergeGeometries(reeds.map(g => g.toNonIndexed()))!;
    return { body: merged };
  }
}
