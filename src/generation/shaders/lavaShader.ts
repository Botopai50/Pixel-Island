import * as THREE from 'three';

export function createLavaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0.0 },
      uLavaCoreColor: { value: new THREE.Color('#ffe248') },  // Amarelo incandescente do núcleo
      uLavaFlowColor: { value: new THREE.Color('#ff4d00') },  // Laranja ardente de magma
      uLavaCrustColor: { value: new THREE.Color('#1f1d22') }, // Placas escuras de basalto resfriado
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.35).normalize() },
      uSunColor: { value: new THREE.Color('#fff8ea') },
      uFogColor: { value: new THREE.Color('#b0d2ee') },
      uFogNear: { value: 200.0 },
      uFogFar: { value: 2400.0 }
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorldPosition;
      varying vec2 vUv;
      varying vec3 vNormal;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);

        // Ondulação suave e viscosa de fluido magmático (como o mar, mas mais denso e lento)
        float wave1 = sin(worldPos.x * 0.045 + uTime * 0.55) * cos(worldPos.z * 0.045 + uTime * 0.45) * 0.18;
        float wave2 = sin(worldPos.x * 0.09 - uTime * 0.35 + worldPos.z * 0.08) * 0.10;
        worldPos.y += wave1 + wave2;

        vWorldPosition = worldPos.xyz;
        vNormal = normalize(vec3(
          -cos(worldPos.x * 0.045 + uTime * 0.55) * 0.03,
          1.0,
          -sin(worldPos.z * 0.045 + uTime * 0.45) * 0.03
        ));

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uLavaCoreColor;
      uniform vec3 uLavaFlowColor;
      uniform vec3 uLavaCrustColor;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;

      varying vec3 vWorldPosition;
      varying vec2 vUv;
      varying vec3 vNormal;

      // Hash procedural para células de convecção térmica
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                   mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        vec2 shift = vec2(100.0);
        mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
        for (int i = 0; i < 4; ++i) {
          v += a * noise(p);
          p = rot * p * 2.0 + shift;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uvCoord = vWorldPosition.xz * 0.06;
        
        // Correntes térmicas de convecção com fluxo lento
        vec2 flow1 = vec2(sin(uTime * 0.12), cos(uTime * 0.10)) * 0.6;
        vec2 flow2 = vec2(cos(uTime * 0.08), sin(uTime * 0.14)) * 0.5;
        
        float n1 = fbm(uvCoord + flow1);
        float n2 = fbm(uvCoord * 2.1 - flow2 + n1 * 0.8);
        
        // Crosta de basalto que se rompe e revela o núcleo de fogo
        float crustFactor = smoothstep(0.42, 0.68, n2);
        
        // Fissuras quentes
        float fissure = 1.0 - smoothstep(0.0, 0.18, abs(n2 - 0.46));
        
        // Gradiente térmico: núcleo brilhante -> magma incandescente -> crosta escura
        vec3 magmaCol = mix(uLavaFlowColor, uLavaCoreColor, n1 * 0.75 + fissure * 0.55);
        vec3 finalLava = mix(magmaCol, uLavaCrustColor, crustFactor * 0.92);
        
        // Brilho emissivo radiante (lava brilha mesmo na sombra)
        finalLava += uLavaCoreColor * fissure * 0.45;
        
        // Reflexo especular sutil
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        vec3 lightDir = normalize(uSunDirection);
        vec3 reflectDir = reflect(-lightDir, vNormal);
        float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0) * 0.25;
        finalLava += uSunColor * spec;

        // Névoa atmosférica de distância
        float dist = length(vWorldPosition - cameraPosition);
        float fogFactor = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 0.85);
        finalLava = mix(finalLava, uFogColor, fogFactor);

        gl_FragColor = vec4(finalLava, 1.0);
      }
    `
  });
}
