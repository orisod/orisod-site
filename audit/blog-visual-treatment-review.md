# Revisión editorial y técnica del inventario visual del blog de Orisod

Fecha de revisión: 2026-08-23  
Fuentes revisadas: `blog-visual-treatment-inventory.jsonl` (42 pares EN/ES) y `blog-visual-treatment-summary.md`

## Veredicto

El inventario es sólido como base de planificación: los 42 registros son válidos, la taxonomía de cinco tipos visuales está bien aplicada y los puntos de inserción son, en general, pertinentes. Sin embargo, no recomiendo comenzar la producción con el archivo tal como está.

Antes de construir los visuales hay que corregir cinco asuntos:

1. Cuatro diagramas marcados como `illustrative` explican mecanismos factuales y deben ser `exact`.
2. La regla de tema duplica innecesariamente todos los bitmaps; solo las capturas reales de interfaz necesitan versiones clara y oscura.
3. Los gráficos y hojas de referencia exactos necesitan un equivalente accesible en HTML; `alt` y `figcaption` no bastan para transmitir tablas o cifras completas.
4. Varios requisitos de verificación dicen únicamente “confirmar lo que afirma el artículo”; eso no constituye verificación independiente ni hace reproducible una comparación.
5. El piloto propuesto no cubre lo que el resumen afirma: omite `code-svg`, no incluye ningún `before-after` y repite `precise-comparison`.

Con las correcciones recomendadas, el reparto quedaría así:

| Dimensión | Inventario actual | Recomendado |
|---|---:|---:|
| Precisión exacta | 36 | 40 |
| Precisión ilustrativa | 6 | 2 |
| Tema compartido | 17 | 27 |
| Versiones clara/oscura | 25 | 15 |
| P1 activo | 16 | 13 |
| P2 | 24 | 26 |
| P3 | 2 | 2 |
| Bloqueado | 0 | 1 |

Los conteos de tipo visual no cambian: no encontré un post cuyo **tipo** principal esté inequívocamente mal clasificado. Los cambios importantes están en precisión, método, localización, tema, verificación y copy.

## 1. Clasificación visual

### Tipos aprobados

La elección entre `interface-screenshot`, `before-after`, `conceptual-diagram`, `precise-comparison` y `reference-sheet` tiene sentido en los 42 casos. En particular:

- Las cuatro secciones vacías están correctamente tratadas como comparaciones precisas u hoja de referencia.
- Los posts que enseñan una operación real del producto están bien orientados a capturas de interfaz.
- Los cambios perceptibles sobre una misma imagen están bien clasificados como `before-after`.
- Los mecanismos abstractos —Base64, DPI, rasterización, orientación EXIF— pertenecen a `conceptual-diagram`, aunque varios deben pasar a precisión exacta.

### Cambios de método o propietario

| Slug | Actual | Recomendación | Motivo |
|---|---|---|---|
| `fix-sideways-photo` | ChatGPT + imagegen, raster, illustrative | hybrid, SVG, exact | La etiqueta de orientación EXIF y el giro de 90° son un mecanismo factual. No debe dibujarse libremente. |
| `what-is-exif-data` | hybrid, SVG, illustrative, EN/ES | ChatGPT + imagegen, raster, illustrative, neutral | Rediseñarlo como ilustración **sin texto ni datos concretos**: foto + iconos de ubicación, reloj y cámara ocultos. Así sigue siendo realmente ilustrativo y sirve para ambos idiomas. |
| `png-vs-jpg` | Code + Playwright, bitmap por tema | Puede conservar el propietario, pero el compuesto debe ser compartido | Es una comparación de dos salidas, no una captura de la interfaz. No cambia con el tema. |

Si se prefiere mantener el diagrama EXIF con etiquetas, coordenadas o campos, entonces debe permanecer en SVG y cambiar a `exact`; no puede conservar simultáneamente etiquetas factuales y precisión `illustrative`.

## 2. Precisión: `illustrative` frente a `exact`

### Cambios obligatorios

| Slug | Actual | Aprobado | Razón |
|---|---|---|---|
| `extract-text-from-pdf` | illustrative | exact | La diferencia entre capa de texto, escaneo y OCR es factual. Además, un escaneo puede tener una capa OCR; no siempre es “solo píxeles”. |
| `how-to-make-a-qr-code` | illustrative | exact | El flujo contenido directo vs. URL de redirección representa una arquitectura real. |
| `fix-sideways-photo` | illustrative | exact | EXIF Orientation tiene valores y efectos definidos; no admite interpretación libre. |
| `pdf-page-to-image` | illustrative | exact | La rasterización es un proceso técnico. Un PDF puede contener texto, vectores e imágenes raster, no solo “instrucciones de dibujo”. |

### Casos ilustrativos aprobados

- `extract-image-from-gif`: una tira de fotogramas estilizada no afirma medidas ni datos.
- `what-is-exif-data`: aprobado como ilustrativo **solo con el rediseño text-free descrito arriba**.

Resultado recomendado: 40 visuales `exact` y 2 `illustrative`.

## 3. Requisitos de verificación

No están completos. Dieciséis registros tienen requisitos específicos, pero muchos visuales exactos no tienen ninguno y varias comparaciones solo piden confirmar cifras tomadas del propio artículo. Recomiendo perfiles reutilizables para evitar repetir reglas en los 42 registros:

| Perfil | Aplicación | Requisitos mínimos |
|---|---|---|
| `tool-ui-capture-v1` | Capturas de interfaz | Build actual; entrada sintética; salida real de la herramienta; configuración registrada; sin simular estados ni editar el resultado. |
| `same-source-output-v1` | Antes/después y crops | Mismo archivo, recorte y dimensiones; salida real; no exagerar diferencias; medir cualquier cifra publicada. |
| `reproducible-benchmark-v1` | AVIF/WebP/JPG/PNG/BMP y compresión | Fuente común; dimensiones; encoder/librería y versión; parámetros; criterio de calidad equivalente; fecha; resultados presentados como “este ejemplo”, no como garantía universal. |
| `authoritative-current-spec-v1` | Tamaños sociales, favicon, estándares | Fuente oficial por dato; URL o documento; fecha de consulta; distinguir recomendado, mínimo y admitido; omitir datos no confirmados. |
| `source-backed-mechanism-v1` | Diagramas técnicos | Fuente primaria o estándar aplicable; etiquetas y relaciones verificadas; ejemplo ficticio claramente identificado cuando corresponda. |

### Requisitos específicos que faltan

- `avif-format-explained`, `jpg-to-webp-guide`, `png-to-webp`, `webp-vs-jpg`, `shrink-bmp-files` y `compress-image-without-losing-quality`: aplicar el benchmark reproducible completo. “Confirmar las cifras del artículo” no basta. Las proporciones dependen del contenido, encoder y ajustes.
- `shrink-bmp-files`: el alt incluye PNG, pero el requisito solo verifica BMP y JPG. Hay que medir PNG también o retirarlo del gráfico.
- `webp-vs-jpg`: verificar por separado y con fecha la compatibilidad de navegadores y aplicaciones; no deducirla de la comparación de tamaño.
- `png-vs-jpg`: usar exactamente la misma fuente y crop, registrar encoder, calidad JPG y escala de ampliación.
- `base64-encoding-explained`: usar la fórmula exacta `4 × ceil(n / 3)` para los bytes codificados, más el prefijo del data URL si se muestra. El “~33 %” es asintótico, no exacto para archivos pequeños.
- `social-media-image-sizes-2026`: registrar fuente oficial y fecha por plataforma y placement; distinguir recomendado/mínimo/admitido; revisión trimestral y revisión obligatoria antes de cambiar el año del título; no publicar un dato sin fuente.
- `what-is-image-metadata`: verificar contra CIPA/EXIF, IPTC y Adobe/XMP; dejar claro que los tres modelos se superponen y no forman cajones mutuamente excluyentes.
- `how-to-make-a-favicon`: verificar el paquete real que genera Orisod y las guías actuales de navegador/OS. No presentar los seis archivos como requeridos universalmente por todo sitio.
- `extract-text-from-pdf`: distinguir PDF con capa textual, escaneo sin OCR y escaneo con capa OCR.
- `pdf-page-to-image`: describir la página como una combinación posible de texto, gráficos vectoriales e imágenes raster que se renderiza a una cuadrícula de píxeles.
- `black-and-white-photo-filter`: comprobar el algoritmo real antes de afirmar que conserva luminancia de forma distinta a reducir saturación.
- `jpg-to-pdf-guide`: confirmar si el JPG se incrusta sin recodificación o si el pipeline decodifica/recomprime; no afirmar que los píxeles “nunca cambian” sin inspeccionar la implementación.
- `merge-multiple-pdfs`: confirmar qué propiedades conserva la librería; “exactamente intactos” es demasiado absoluto.
- `sign-pdf-online`: usar firma sintética marcada `SAMPLE`, nunca una firma real.
- `blur-face-in-photo`: conservar el requisito ya presente de usar una persona sintética, stock con licencia o modelo autorizado.
- Capturas con documentos o fotos: usar material sintético sin nombres, direcciones, firmas ni metadatos personales reales.

### Caso crítico: `social-media-image-sizes-2026`

La clasificación `reference-sheet`, `exact` y P1 es correcta. Debe cambiar de `language-neutral` a `requires-en-es-versions`, porque etiquetas como Post, Story, Cover y Banner forman parte del contenido editorial.

Además, no debería existir solo como SVG. La tabla exacta debe estar también en HTML semántico y visible —o como mínimo disponible en un bloque textual adyacente equivalente— para accesibilidad, selección, traducción y mantenimiento. El SVG puede ser una presentación visual complementaria.

## 4. Accesibilidad y reglas técnicas

Las reglas propuestas son técnicamente viables:

- `<figure>` + `<img>` + `<figcaption>`
- `width` y `height` explícitos
- `loading="lazy"` debajo del pliegue
- rutas `/assets/blog/<slug>/<nombre>.webp`
- render correcto en ambos temas

Pero son insuficientes para visuales exactos complejos. El `alt` no debe convertirse en una tabla escondida ni repetir cada cifra. Recomiendo añadir al esquema:

```json
"accessible_equivalent": "html-table | adjacent-text-summary | nearby-prose | none"
```

Regla:

- `precise-comparison` y `reference-sheet`: `html-table` obligatorio.
- Diagrama exacto con cifras o etiquetas esenciales: `adjacent-text-summary` o tabla.
- Captura de interfaz y before/after: `nearby-prose` suele bastar; alt describe la imagen y el caption explica su conclusión.
- Ilustración decorativa que no aporta información adicional: alt vacío, aunque ninguno de los pilotos propuestos debería ser puramente decorativo.

Las cuatro secciones con encabezado vacío no deben quedar con “el gráfico como única explicación”. Añadir una frase introductoria y el equivalente HTML correspondiente.

## 5. Tema claro/oscuro

La justificación del resumen —“todo bitmap necesita dos versiones porque no reacciona al toggle”— es técnicamente cierta pero editorialmente innecesaria. Una fotografía o un compuesto antes/después no tiene por qué cambiar con el tema.

Regla recomendada:

- Captura de **interfaz** de Orisod: `separate-light-dark` si se desea que coincida con el tema activo.
- Antes/después, crop comparativo e ilustración imagegen: `shared`, con fondo neutro o transparente y borde compatible con ambos temas.
- SVG: `shared`, usando variables de color del sistema cuando corresponda.

Cambiar a `shared` estos diez registros:

`png-vs-jpg`, `resize-image-without-distorting`, `add-photo-border-online`, `black-and-white-photo-filter`, `blur-face-in-photo`, `extract-image-from-gif`, `fix-sideways-photo`, `round-image-corners-guide`, `trim-pdf-margins` y `watermark-photos-guide`.

Con ello solo las 15 capturas reales de interfaz conservan versiones clara/oscura. Incluso esas podrían reducirse a una captura canónica compartida en el futuro, pero mantener ambas es una decisión visual válida.

## 6. Prioridades

La jerarquía general tiene sentido. Recomiendo solo tres cambios:

| Slug | Actual | Recomendado | Motivo |
|---|---:|---|---|
| `compress-pdf-without-losing-quality` | P1 | `blocked` | El copy no representa Quick clean / Strong compression. No se debe construir aún. |
| `find-color-code-from-image` | P1 | P2 | La interfaz ya es fácil de entender y la guía funciona sin el screenshot. |
| `how-to-make-a-qr-code` | P1 | P2 | El diagrama aporta claridad, pero no tiene la urgencia de una sección vacía o una comparación central. |

Mantendría como P1 los cuatro encabezados vacíos y los posts donde la comparación o el concepto es el núcleo editorial: compresión de imagen, extracción de texto, favicon, conversiones WebP, PNG vs. JPG, proporción de aspecto, SVG y privacidad EXIF.

## 7. Alt text y captions

La mayoría describe correctamente el contenido y evita empezar mecánicamente con “Imagen de…”. Los siguientes sí requieren corrección. Estos textos reemplazan las versiones actuales:

| Slug | Campo | Texto aprobado |
|---|---|---|
| `avif-format-explained` | alt ES | Gráfico de barras que compara el tamaño de AVIF, WebP y JPG en este ejemplo con una calidad visual equivalente; AVIF es el archivo más pequeño. |
| `extract-text-from-pdf` | caption EN | Text can be extracted when a PDF contains a text layer. Image-only scans need OCR first. |
|  | caption ES | El texto puede extraerse cuando el PDF contiene una capa de texto. Los escaneos compuestos solo por imágenes necesitan OCR. |
| `find-color-code-from-image` | caption ES | Haz clic en un píxel y obtén su código exacto, sin abrir un programa de diseño. |
| `how-to-make-a-favicon` | caption EN | A complete favicon package commonly includes several files for different browsers and devices. |
|  | caption ES | Un paquete de favicon completo suele incluir varios archivos para distintos navegadores y dispositivos. |
| `how-to-make-a-qr-code` | caption EN | A static QR stores its destination directly. A dynamic QR depends on a redirect service. |
|  | caption ES | Un QR estático almacena el destino directamente. Un QR dinámico depende de un servicio de redirección. |
| `what-is-exif-data` | alt EN | Illustration of a photo carrying hidden location, time, and camera information. |
|  | alt ES | Ilustración de una foto que lleva información oculta de ubicación, hora y cámara. |
|  | caption EN | When present, details such as location, time, and device information can travel with the file. |
|  | caption ES | Cuando están presentes, datos como la ubicación, la hora y el dispositivo pueden viajar con el archivo. |
| `add-page-numbers-to-pdf` | caption EN | Choose the position and starting number before applying the numbering. |
|  | caption ES | Elige la posición y el número inicial antes de aplicar la numeración. |
| `add-photo-border-online` | caption ES | Un borde fino produce un efecto clásico; uno más grueso resulta más llamativo. |
| `base64-encoding-explained` | caption ES | Base64 aumenta el tamaño a cambio de poder incrustar los datos como texto. |
| `combine-photos-into-pdf` | caption EN | Reorder the photos before combining them; the final list order becomes the PDF page order. |
|  | caption ES | Reordena las fotos antes de combinarlas; el orden final de la lista será el orden de las páginas del PDF. |
| `fix-sideways-photo` | caption ES | Algunas aplicaciones leen la etiqueta de orientación; otras muestran los píxeles tal como están almacenados. |
| `heic-to-jpg-guide` | caption EN | Convert HEIC to JPG without installing software. |
|  | caption ES | Convierte HEIC a JPG sin instalar programas. |
| `jpg-to-pdf-guide` | caption EN | The photo is placed into a standard PDF file in one step. |
|  | caption ES | La foto se incorpora a un archivo PDF estándar en un solo paso. |
| `merge-multiple-pdfs` | caption EN | Reorder the files, then merge them without rasterizing the pages. |
|  | caption ES | Reordena los archivos y únelos sin rasterizar las páginas. |
| `pdf-page-to-image` | alt EN | Diagram showing a PDF page with text, vector graphics, and embedded images rendered into a fixed pixel grid. |
|  | alt ES | Diagrama que muestra una página PDF con texto, gráficos vectoriales e imágenes incrustadas renderizada en una cuadrícula fija de píxeles. |
|  | caption EN | Rasterization renders the complete PDF page into a fixed grid of pixels. |
|  | caption ES | La rasterización convierte la página PDF completa en una cuadrícula fija de píxeles. |
| `split-pdf-guide` | caption EN | Extract one page range as a PDF, or split every page into separate files. |
|  | caption ES | Extrae un rango de páginas como PDF o separa cada página en un archivo individual. |
| `trim-pdf-margins` | caption EN | The page content stays the same; only the visible page boundary changes. |
|  | caption ES | El contenido de la página no cambia; solo cambia el límite visible de la página. |
| `watermark-pdf-documents` | caption ES | Una marca diagonal con opacidad moderada sigue siendo visible sin ocultar el contenido. |
| `what-is-image-metadata` | caption EN | EXIF, IPTC, and XMP overlap, but each emphasizes different kinds of metadata. |
|  | caption ES | EXIF, IPTC y XMP se superponen, pero cada uno da prioridad a distintos tipos de metadatos. |
| `how-to-open-webp-file` | caption EN | Convert WebP to PNG for broader compatibility with apps that do not support WebP. |
|  | caption ES | Convierte WebP a PNG para usarlo en más aplicaciones que no admiten WebP. |

Aplicar además una normalización editorial general:

- EN: rangos con raya (`25–35%`) y espacio entre número y unidad (`200 KB`).
- ES: coma decimal, espacio antes de `%` y entre número/unidad (`1,3 MB`, `25–35 %`, `3000 × 2000 px`).
- En gráficos de compresión, añadir “in this example” / “en este ejemplo” para no presentar resultados de una muestra como una ley universal.

## 8. Piloto recomendado

El piloto actual no cumple su propia promesa: representa tres propietarios, no cuatro; incluye cuatro tipos visuales, no cinco; omite `before-after`; y usa dos `precise-comparison`.

Recomiendo estos cinco:

| # | Slug | Tipo | Propietario/método | Precisión | Idioma | Tema | Qué valida |
|---:|---|---|---|---|---|---|---|
| 1 | `shrink-bmp-files` | precise-comparison | hybrid + SVG | exact | EN/ES | shared | Composición especificada por ChatGPT, datos reproducibles, SVG y sección vacía. |
| 2 | `social-media-image-sizes-2026` | reference-sheet | hybrid + SVG + tabla HTML | exact | EN/ES | shared | Datos volátiles, fuentes oficiales, localización y accesibilidad. |
| 3 | `find-color-code-from-image` | interface-screenshot | Code + Playwright | exact | EN/ES | light/dark | Captura real de herramienta y cuatro variantes. |
| 4 | `what-is-exif-data` | conceptual-diagram | ChatGPT + imagegen | illustrative | neutral | shared | Ilustración libre segura, sin texto ni datos inventados. |
| 5 | `resize-image-without-distorting` | before-after | Code + salida real | exact | neutral | shared | Compuesto bitmap reutilizable y comparación controlada. |

Este conjunto cubre los cinco tipos visuales y ambos tratamientos de tema. Cubre tres rutas técnicas reales: Playwright, SVG/híbrido e imagegen.

Si se considera indispensable validar también la etiqueta de propietario `code-svg` —aunque técnicamente use el mismo pipeline SVG que `hybrid`—, añadir un sexto piloto:

- `svg-to-png-guide`: `code-svg`, conceptual, exact, neutral y shared.

Retiraría `jpg-to-webp-guide` del piloto inicial: duplica el patrón de comparación precisa ya cubierto por BMP y añade un visual secundario antes de haber validado el modelo básico.

## 9. Visuales secundarios

Los 11 `secondary_visual` contienen solo `description`. No son todavía especificaciones ejecutables. Antes de construir cualquiera, deben usar el mismo esquema del visual principal:

- tipo
- punto de inserción EN/ES
- propietario y método
- precisión
- localización
- tratamiento de tema
- formato
- requisitos de verificación
- alt y caption EN/ES
- equivalente accesible

Para el piloto conviene no construir secundarios. Primero se valida un visual principal por patrón; después se decide si el segundo visual aporta suficiente valor editorial.

## Decisión final

**Aprobado con cambios obligatorios antes de producción.** Claude Code puede conservar los 42 tipos visuales y puntos de inserción, pero debe incorporar la capa de decisiones adjunta, corregir el piloto y bloquear `compress-pdf-without-losing-quality` hasta que el artículo refleje el funcionamiento actual.
