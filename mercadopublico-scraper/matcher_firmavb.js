/**
 * Matcher FirmaVB - Categorización automática de licitaciones
 * 
 * Categorías FirmaVB:
 * 1. Artículos de oficina
 * 2. Aseo
 * 3. Electrodomésticos
 * 4. Insumos desechables
 * 5. Mobiliario
 * 6. Alimentos
 */

// Palabras clave por categoría (lowercase)
const CATEGORIAS_KEYWORDS = {
  articulos_oficina: [
    'papel', 'lapiz', 'lapices', 'boligrafo', 'carpeta', 'archivador',
    'toner', 'cartucho', 'tinta', 'impresora', 'fotocopiadora',
    'escritorio', 'silla oficina', 'organizador', 'perforadora',
    'engrapadora', 'clips', 'post-it', 'marcador', 'resaltador',
    'cuaderno', 'block', 'sobre', 'cartulina', 'pizarra',
    'calculadora', 'portaminas', 'goma', 'corrector', 'tijeras',
    'pegamento', 'cinta adhesiva', 'carpeta', 'folder', 'articulo oficina',
    'material oficina', 'utiles oficina', 'suministro oficina'
  ],
  
  aseo: [
    'jabon', 'detergente', 'desinfectante', 'cloro', 'limpieza',
    'escoba', 'pala', 'trapeador', 'mopa', 'franela', 'paño',
    'papel higienico', 'papel toalla', 'toalla papel', 'servilleta',
    'bolsa basura', 'guante', 'dispensador', 'basurero', 'papelero',
    'limpia vidrio', 'cera', 'lustrador', 'desodorante ambiental',
    'aromatizante', 'shampoo', 'jabon liquido', 'alcohol gel',
    'sanitizante', 'bactericida', 'desengrasante', 'lavavajilla',
    'esponja', 'virulana', 'producto aseo', 'material aseo',
    'articulo limpieza', 'insumo aseo', 'utensilio aseo'
  ],
  
  electrodomesticos: [
    'refrigerador', 'refrigeradora', 'nevera', 'heladera', 'freezer',
    'microondas', 'horno', 'cocina', 'cocinilla', 'anafe',
    'lavadora', 'secadora', 'lavavajilla', 'lavaplatos',
    'aspiradora', 'ventilador', 'calefactor', 'estufa', 'calefaccion',
    'aire acondicionado', 'climatizador', 'purificador aire',
    'licuadora', 'juguera', 'batidora', 'procesador', 'multiprocesador',
    'cafetera', 'tetera', 'hervidor', 'tostador', 'sandwichera',
    'plancha', 'secador pelo', 'dispensador agua', 'calentador',
    'campana extractora', 'televisor', 'tv', 'monitor',
    'electrodomestico', 'artefacto electrico', 'equipo cocina'
  ],
  
  insumos_desechables: [
    'vaso desechable', 'plato desechable', 'cubierto desechable',
    'bandeja desechable', 'envase desechable', 'contenedor desechable',
    'servilleta', 'servilletero', 'mantel papel', 'mantel desechable',
    'cuchillo plastico', 'tenedor plastico', 'cuchara plastica',
    'pitillo', 'bombilla', 'popote', 'sorbete',
    'bolsa plastica', 'bolsa papel', 'cajas carton',
    'papel aluminio', 'film plastico', 'papel encerado',
    'guante latex', 'guante nitrilo', 'guante vinilo',
    'mascarilla', 'cubreboca', 'cofia', 'gorro',
    'delantal desechable', 'bata desechable', 'toalla desechable',
    'pañuelo papel', 'tissue', 'insumo desechable', 'descartable',
    'plastico', 'carton', 'biodegradable', 'compostable'
  ],
  
  mobiliario: [
    'escritorio', 'mesa', 'silla', 'sillon', 'sofa',
    'estante', 'estanteria', 'repisa', 'biblioteca', 'librero',
    'archivador', 'cajonera', 'gaveta', 'mueble archivo',
    'armario', 'closet', 'ropero', 'locker', 'casillero',
    'credenza', 'mostrador', 'counter', 'recepcion',
    'mesa reunion', 'mesa conferencia', 'mesa trabajo',
    'banco', 'taburete', 'butaca', 'puff', 'pouf',
    'mueble', 'mobiliario', 'mobiliario oficina',
    'escritorio ejecutivo', 'silla ergonomica', 'silla oficina',
    'panel divisorio', 'biombo', 'mampara', 'separador',
    'perchero', 'colgador', 'porta', 'soporte',
    'vitrina', 'exhibidor', 'mueble cocina', 'alacena'
  ],
  
  alimentos: [
    'cafe', 'te', 'azucar', 'endulzante', 'edulcorante',
    'leche', 'lacteo', 'yogurt', 'queso', 'mantequilla',
    'pan', 'galleta', 'bizcocho', 'pastel', 'torta',
    'jugo', 'refresco', 'bebida', 'agua', 'mineral',
    'fruta', 'verdura', 'hortaliza', 'vegetal', 'ensalada',
    'carne', 'pollo', 'pescado', 'mariscos', 'embutido',
    'arroz', 'fideos', 'pasta', 'tallarines', 'espagueti',
    'legumbre', 'lenteja', 'poroto', 'garbanzo', 'frejol',
    'aceite', 'vinagre', 'sal', 'pimienta', 'condimento',
    'salsa', 'aderezo', 'mayonesa', 'ketchup', 'mostaza',
    'cereal', 'avena', 'granola', 'barra', 'snack',
    'chocolate', 'dulce', 'caramelo', 'golosina', 'confite',
    'alimento', 'comida', 'alimenticio', 'producto alimenticio',
    'víveres', 'viveres', 'abarrote', 'comestible', 'refrigerio',
    'colacion', 'menu', 'ración', 'racion', 'bandeja comida'
  ]
};

const CATEGORIA_LABELS = {
  articulos_oficina: 'Artículos de Oficina',
  aseo: 'Aseo y Limpieza',
  electrodomesticos: 'Electrodomésticos',
  insumos_desechables: 'Insumos Desechables',
  mobiliario: 'Mobiliario',
  alimentos: 'Alimentos y Bebidas'
};

/**
 * Normaliza texto para matching (lowercase, sin tildes)
 */
function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula score de matching para una categoría
 */
function calculateCategoryScore(normalizedText, keywords) {
  let score = 0;
  let matchedWords = [];
  
  for (const keyword of keywords) {
    if (normalizedText.includes(keyword)) {
      // Bonificación por keyword más específica (más larga)
      const bonus = keyword.length > 8 ? 2 : 1;
      score += bonus;
      matchedWords.push(keyword);
    }
  }
  
  return { score, matchedWords };
}

/**
 * Clasifica una licitación en categorías FirmaVB
 * @param {Object} licitacion - Objeto con { titulo, descripcion, items }
 * @returns {Object} { categoria, score, palabras_encontradas }
 */
function matchLicitacion(licitacion) {
  // Construir texto combinado para análisis
  const textoParts = [
    licitacion.titulo || '',
    licitacion.descripcion || ''
  ];
  
  // Agregar items si existen
  if (Array.isArray(licitacion.items)) {
    licitacion.items.forEach(item => {
      textoParts.push(item.nombre || '');
      textoParts.push(item.descripcion || '');
    });
  }
  
  const textoCompleto = textoParts.join(' ');
  const textoNormalizado = normalizeText(textoCompleto);
  
  if (!textoNormalizado) {
    return { categoria: null, categoria_match: null, match_score: 0, palabras_encontradas: [] };
  }
  
  // Calcular scores para cada categoría
  const resultados = [];
  
  for (const [categoriaKey, keywords] of Object.entries(CATEGORIAS_KEYWORDS)) {
    const { score, matchedWords } = calculateCategoryScore(textoNormalizado, keywords);
    
    if (score > 0) {
      resultados.push({
        categoria: categoriaKey,
        categoria_match: CATEGORIA_LABELS[categoriaKey],
        match_score: score,
        palabras_encontradas: matchedWords
      });
    }
  }
  
  // Si no hay matches, retornar null
  if (resultados.length === 0) {
    return { categoria: null, categoria_match: null, match_score: 0, palabras_encontradas: [] };
  }
  
  // Ordenar por score descendente y retornar el mejor
  resultados.sort((a, b) => b.match_score - a.match_score);
  
  return resultados[0];
}

/**
 * Filtra licitaciones que matchean con categorías FirmaVB
 * @param {Array} licitaciones - Array de licitaciones
 * @returns {Array} Licitaciones filtradas con campos de matching
 */
function filterFirmaVBLicitaciones(licitaciones) {
  if (!Array.isArray(licitaciones)) return [];
  
  return licitaciones
    .map(lic => {
      const matchResult = matchLicitacion(lic);
      return {
        ...lic,
        ...matchResult
      };
    })
    .filter(lic => lic.categoria !== null); // Solo las que matchean
}

module.exports = {
  matchLicitacion,
  filterFirmaVBLicitaciones,
  CATEGORIAS_KEYWORDS,
  CATEGORIA_LABELS
};
