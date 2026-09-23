// Configurações globais do simulador de ilhas procedurais
export const CONFIG = {
  // Configurações de Terreno e Chunks
  CHUNK_SIZE: 64, // Tamanho de cada chunk no espaço do mundo (unidades)
  CHUNK_SEGMENTS: 32, // Resolução facetada de alta fidelidade e excelente performance
  
  VIEW_RADIUS_CHUNKS: 12,  // Raio mínimo de visão no modo aéreo (~768m); cresce com o zoom afastado
  MAX_VIEW_RADIUS_CHUNKS: 22, // Raio no zoom mais afastado (~1.4km): preenche a tela inteira
  VEGETATION_RADIUS_CHUNKS: 6, // Raio de instanciamento botânico otimizado (~384m)
  UNLOAD_MARGIN_CHUNKS: 1, // Margem antes de descarregar chunk da memória
  
  // Níveis de Altura e Relevo
  SEA_LEVEL: 0.0,
  BEACH_HEIGHT: 3.8, // Faixa praiana completa (da areia molhada até o início da vegetação interiorana)
  MAX_HEIGHT: 160.0,
  OCEAN_FLOOR: -40.0,
  
  // Escala Geográfica Macro Continental
  ISLAND_GRID_SIZE: 3200.0, // Espaçamento entre centros de placas continentais (~3.2km)
  ISLAND_BASE_RADIUS: 1400.0, // Raio base de grandes massas de terra continentais (~1.4km de semi-eixo)
  
  // Câmera de Observação
  CAMERA: {
    DEFAULT_PITCH: 50 * (Math.PI / 180), // Ângulo de inclinação elevada
    DEFAULT_YAW: 42 * (Math.PI / 180),   // Ângulo azimutal
    MIN_FRUSTUM_SIZE: 22,                // Zoom máximo (muito próximo: vê folhas, rochas)
    MAX_FRUSTUM_SIZE: 1400,              // Zoom mínimo (afastado: vê o continente inteiro sem bordas)
    DEFAULT_FRUSTUM_SIZE: 160,           // Padrão inicial
    BASE_MOVE_SPEED: 45.0,               // Velocidade base em frustum médio
    ACCELERATION: 12.0,                  // Taxa de aceleração da câmera
    DAMPING: 7.0,                        // Amortecimento / inércia suave
    ZOOM_SENSITIVITY: 0.14,              // Sensibilidade do scroll
    ROTATION_SENSITIVITY: 0.0048,        // Sensibilidade da rotação horizontal (botão direito)
  },

  // Vegetação e Detalhes
  VEGETATION: {
    MAX_TREES_PER_CHUNK: 220,
    MAX_ROCKS_PER_CHUNK: 140,
    MAX_SHRUBS_PER_CHUNK: 180,
    MAX_LOGS_PER_CHUNK: 40,
    MAX_SLOPE_FOR_TREES: 0.62, // Árvores não crescem em encostas muito íngremes (~35°)
    MAX_SLOPE_FOR_ROCKS: 0.50, // Rochas não nascem em penhascos íngremes evitando flutuação visual (~26°)
  }
};
