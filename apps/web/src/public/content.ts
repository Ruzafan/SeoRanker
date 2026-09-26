/** Contenido de las páginas públicas. Sin cifras inventadas: solo hechos del producto y criterio. */

export interface Faq {
  q: string;
  a: string;
}

export const LANDING_FAQS: Faq[] = [
  {
    q: '¿Google penaliza el contenido escrito con IA?',
    a: 'Google valora que el contenido sea útil, no cómo se ha escrito. Por eso cada artículo parte de lo que ya posiciona para esa búsqueda, responde a una pregunta real de tus clientes, usa la experiencia de tu negocio que tú aportas y enlaza solo a páginas que existen. Y siempre puedes revisarlo antes de publicar.',
  },
  {
    q: '¿Tengo que instalar algo en WordPress?',
    a: 'Para empezar, no: basta una contraseña de aplicación de WordPress, que puedes revocar cuando quieras. Recomendamos además nuestro conector (un plugin de un clic) para rellenar la meta de Yoast o Rank Math y publicar las preguntas frecuentes como datos estructurados.',
  },
  {
    q: '¿Cómo sé si funciona?',
    a: 'Conecta Google Search Console y verás los clics, impresiones y posición de cada artículo, cuáles pierden tráfico y qué búsquedas están a un paso de la primera página. En los planes Pro y Agency, también las ventas de WooCommerce que empezaron en un artículo.',
  },
  {
    q: '¿Publica solo o puedo revisar antes?',
    a: 'Tú eliges por tienda: dejar borradores en WordPress, publicar automáticamente con la frecuencia que marques, o pedir la aprobación de un cliente antes de publicar (plan Agency).',
  },
  {
    q: '¿Cuándo se notan los resultados?',
    a: 'El SEO es acumulativo: los primeros artículos suelen empezar a posicionar en semanas y el efecto crece a medida que publicas. Depende de tu sector y de la competencia de cada búsqueda; Search Console te lo mostrará con datos reales.',
  },
  {
    q: '¿Y si tengo Shopify?',
    a: 'Estamos preparando la integración con Shopify. Mientras tanto, SEO Autopilot funciona con WordPress y WooCommerce.',
  },
];

export interface Comparison {
  slug: string;
  name: string;
  title: string;
  description: string;
  intro: string;
  rows: { aspect: string; us: string; them: string }[];
  /** Honestidad: cuándo es mejor la alternativa. */
  chooseThem: string[];
  chooseUs: string[];
}

export const COMPARISONS: Comparison[] = [
  {
    slug: 'agencia-seo',
    name: 'una agencia SEO',
    title: 'SEO Autopilot vs contratar una agencia SEO para el blog de tu tienda',
    description:
      'Diferencias en coste, volumen, control y resultados medibles entre SEO Autopilot y una agencia SEO para el contenido de una tienda WooCommerce.',
    intro:
      'Una agencia aporta estrategia y criterio humano; SEO Autopilot automatiza la parte que más horas consume: investigar búsquedas, escribir y publicar de forma constante. No son excluyentes: muchas agencias usan herramientas así para producir más con el mismo equipo.',
    rows: [
      {
        aspect: 'Coste mensual',
        us: 'Desde 19 € al mes con la IA incluida',
        them: 'Habitualmente cientos o miles de euros al mes',
      },
      {
        aspect: 'Volumen',
        us: 'De 20 a 400 artículos al mes según plan',
        them: 'Limitado por las horas contratadas',
      },
      {
        aspect: 'Plazo del primer artículo',
        us: 'Minutos tras conectar la tienda',
        them: 'Días o semanas (briefing, redacción, revisión)',
      },
      {
        aspect: 'Medición',
        us: 'Search Console y ventas atribuidas por artículo en el panel',
        them: 'Informes periódicos, según la agencia',
      },
      {
        aspect: 'Estrategia y enlaces externos',
        us: 'No hace link building ni auditorías técnicas',
        them: 'Pueden incluir link building, auditorías y estrategia de marca',
      },
    ],
    chooseThem: [
      'Necesitas link building, auditorías técnicas o una estrategia integral.',
      'Tu sector es muy regulado (salud, finanzas) y cada texto requiere revisión experta.',
    ],
    chooseUs: [
      'Quieres publicar de forma constante sin depender de horas de redacción.',
      'Prefieres ver en un panel qué artículos traen clics y ventas.',
      'Gestionas varias tiendas y necesitas volumen a un coste predecible.',
    ],
  },
  {
    slug: 'redactor-freelance',
    name: 'un redactor freelance',
    title: 'SEO Autopilot vs un redactor freelance para tu tienda online',
    description:
      'Coste por artículo, investigación de keywords, publicación y medición: qué cambia entre SEO Autopilot y un redactor freelance.',
    intro:
      'Un buen redactor escribe con criterio propio, pero la investigación de keywords, la maquetación en WordPress, la meta SEO y la medición suelen quedar de tu parte. SEO Autopilot hace todo el ciclo y tú revisas.',
    rows: [
      {
        aspect: 'Coste por artículo',
        us: 'Entre 0,37 € y 0,95 € según plan',
        them: 'Habitualmente varias decenas de euros por artículo largo',
      },
      {
        aspect: 'Investigación de keywords',
        us: 'Incluida: autocompletado, preguntas y Search Console',
        them: 'Suele depender de ti o cobrarse aparte',
      },
      {
        aspect: 'Publicación y meta SEO',
        us: 'Automática, con Yoast o Rank Math rellenado',
        them: 'Manual',
      },
      {
        aspect: 'Voz de marca',
        us: 'Aprendida de tus textos publicados',
        them: 'Muy buena si trabaja contigo a largo plazo',
      },
      {
        aspect: 'Experiencia de primera mano',
        us: 'Solo la que tú escribes en Ajustes',
        them: 'Puede entrevistarte y aportar la suya',
      },
    ],
    chooseThem: [
      'Necesitas piezas de autor, entrevistas o contenido de opinión.',
      'Publicas pocos artículos y cada uno es una pieza de marca.',
    ],
    chooseUs: [
      'Necesitas volumen constante para cubrir cientos de búsquedas de tu catálogo.',
      'Quieres el ciclo completo (keyword → artículo → WordPress → medición) sin gestionarlo.',
    ],
  },
  {
    slug: 'chatgpt',
    name: 'escribir con ChatGPT a mano',
    title: 'SEO Autopilot vs escribir los artículos de tu tienda con ChatGPT',
    description:
      'Por qué pedir artículos a un chat no es lo mismo que un sistema de contenido SEO: keywords, SERP, enlaces reales, publicación y medición.',
    intro:
      'Un chat escribe bien si le das el contexto adecuado cada vez. SEO Autopilot pone ese contexto de forma sistemática: qué busca tu cliente, qué posiciona ya en Google, tu voz, tus productos y tus páginas reales.',
    rows: [
      {
        aspect: 'Elegir el tema',
        us: 'Keywords puntuadas desde tu catálogo y Search Console',
        them: 'Lo decides tú en cada conversación',
      },
      {
        aspect: 'Analizar la competencia',
        us: 'Lee el top 10 de Google antes de cada esquema',
        them: 'Solo si lo investigas y se lo pegas',
      },
      {
        aspect: 'Enlaces internos',
        us: 'Solo a páginas que existen en tu tienda',
        them: 'Puede inventar URL',
      },
      {
        aspect: 'Publicación',
        us: 'Automática en WordPress con meta SEO y FAQ estructurado',
        them: 'Copiar, pegar y maquetar a mano',
      },
      {
        aspect: 'Seguimiento',
        us: 'Clics, posiciones, caídas y ventas por artículo',
        them: 'Ninguno',
      },
    ],
    chooseThem: ['Escribes muy pocos artículos y disfrutas del proceso.'],
    chooseUs: [
      'Quieres un proceso repetible que no dependa de tu tiempo.',
      'Te importa que cada artículo parta de datos (búsquedas, SERP) y se mida.',
    ],
  },
];

export interface Vertical {
  slug: string;
  name: string;
  title: string;
  description: string;
  intro: string;
  /** Búsquedas típicas del sector (ejemplos de formato, no datos de volumen). */
  searches: string[];
  angles: { title: string; text: string }[];
}

export const VERTICALS: Vertical[] = [
  {
    slug: 'moda',
    name: 'moda',
    title: 'SEO para tiendas de moda online: artículos que venden',
    description:
      'Cómo una tienda de moda en WooCommerce puede atraer tráfico con guías de tallas, estilo y cuidado de prendas, generadas y publicadas automáticamente.',
    intro:
      'En moda, la mayoría de búsquedas no son de producto sino de duda: qué ponerse, qué talla elegir, cómo cuidar una prenda. Responderlas trae visitas que ya están cerca de comprar.',
    searches: [
      'cómo combinar una falda midi',
      'qué talla de vaquero elegir',
      'cómo lavar un jersey de lana sin que encoja',
      'diferencia entre lino y algodón',
    ],
    angles: [
      {
        title: 'Guías de tallas y ajuste',
        text: 'Reducen devoluciones y posicionan para búsquedas de duda antes de comprar.',
      },
      {
        title: 'Cuidado de prendas',
        text: 'Contenido perenne que enlaza a los productos del material del que se habla.',
      },
      {
        title: 'Ideas de estilo por ocasión',
        text: 'Bodas, trabajo, verano: cada ocasión es una búsqueda con intención comercial.',
      },
    ],
  },
  {
    slug: 'cosmetica',
    name: 'cosmética',
    title: 'SEO para tiendas de cosmética y cuidado personal',
    description:
      'Rutinas, ingredientes y comparativas: el contenido que busca el cliente de cosmética, escrito con la voz de tu marca y publicado en tu WooCommerce.',
    intro:
      'El comprador de cosmética investiga: ingredientes, tipos de piel, rutinas. Una tienda que responde con rigor gana confianza y tráfico. Aporta en Ajustes lo que sabéis (formulación, pruebas, experiencia) y los artículos lo usarán sin inventar más.',
    searches: [
      'rutina de noche para piel mixta',
      'para qué sirve el niacinamida',
      'diferencia entre sérum y crema hidratante',
      'cómo aplicar protector solar con maquillaje',
    ],
    angles: [
      {
        title: 'Ingredientes explicados',
        text: 'Qué hace cada activo y en qué productos de tu tienda está.',
      },
      {
        title: 'Rutinas por tipo de piel',
        text: 'Con tarjetas de los productos que encajan en cada paso.',
      },
      { title: 'Comparativas', text: 'Tablas claras entre texturas, formatos o activos.' },
    ],
  },
  {
    slug: 'mascotas',
    name: 'mascotas',
    title: 'SEO para tiendas de productos para mascotas',
    description:
      'Alimentación, salud y educación de perros y gatos: artículos útiles que llevan a los productos de tu tienda de mascotas.',
    intro:
      'Los dueños de mascotas buscan constantemente: cuánto debe comer, qué juguete elegir, cómo educar. Son búsquedas recurrentes con mucho volumen y una compra natural al final.',
    searches: [
      'cuánto debe comer un cachorro',
      'mejor arena para gatos sin olor',
      'cómo enseñar a un perro a no tirar de la correa',
      'juguetes para perros que rompen todo',
    ],
    angles: [
      {
        title: 'Alimentación por edad y tamaño',
        text: 'Tablas prácticas y los piensos de tu catálogo en cada caso.',
      },
      {
        title: 'Problemas del día a día',
        text: 'Olores, pelo, ansiedad: soluciones con productos concretos.',
      },
      {
        title: 'Guías de compra',
        text: 'Qué mirar al elegir un arnés, una cama o un transportín.',
      },
    ],
  },
  {
    slug: 'decoracion',
    name: 'decoración',
    title: 'SEO para tiendas de decoración y hogar',
    description:
      'Ideas, medidas y estilos: contenido de decoración que posiciona y enlaza a los productos de tu tienda WooCommerce.',
    intro:
      'Decorar empieza con una búsqueda de inspiración o de medidas. Un blog que resuelve esas dudas atrae visitas en todas las fases de la compra.',
    searches: [
      'cómo decorar un salón pequeño',
      'qué altura poner un cuadro',
      'colores que combinan con el verde salvia',
      'cómo elegir el tamaño de una alfombra',
    ],
    angles: [
      {
        title: 'Medidas y reglas prácticas',
        text: 'Alturas, distancias y proporciones, con tablas.',
      },
      {
        title: 'Estilos',
        text: 'Nórdico, japandi, industrial: qué piezas de tu tienda encajan en cada uno.',
      },
      {
        title: 'Por estancias',
        text: 'Salón, dormitorio o terraza: cada una, una familia de búsquedas.',
      },
    ],
  },
];
