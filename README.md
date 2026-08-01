# Reader TTS

Aplicación web instalable (PWA) para escuchar EPUBs con voces de IA.

- Subís tus `.epub` y quedan guardados en tu cuenta
- Text-to-speech vía **OpenRouter** (`POST /api/v1/audio/speech`), modelo configurable
- Recuerda dónde quedaste, en cada dispositivo
- Interfaz y lectura en **español** e **inglés**
- Login con **Google**
- Funciona sin conexión con los libros ya descargados

## Cómo está armado

| Capa | Tecnología |
|---|---|
| Front | React 19 + TypeScript + Vite + Tailwind v4 |
| PWA | `vite-plugin-pwa` (Workbox) |
| EPUB | JSZip + DOMParser + DOMPurify (renderer propio) |
| Server | Cloudflare Pages Functions |
| Datos | Cloudflare D1 (SQLite) |
| Archivos | Cloudflare KV (epubs y portadas) |

### Decisiones que conviene conocer

**La API key de OpenRouter nunca llega al navegador.** Se guarda cifrada con
AES-GCM en D1 y solo se descifra dentro del Worker, que hace la llamada a
OpenRouter y devuelve el audio. Además evita depender del CORS de OpenRouter.

**El audio se cachea solo en el dispositivo**, en IndexedDB, con clave
`sha256(modelo|voz|texto)`. Volver a escuchar un capítulo en el mismo navegador
no se cobra de nuevo; hacerlo en otro dispositivo sí, porque no hay copia en el
servidor.

**Los archivos van a KV, no a R2.** R2 exige registrar una tarjeta aunque el
free tier no cobre. KV lo evita, a cambio de un tope de 25 MiB por EPUB y de no
soportar descargas parciales (Range). El acceso está aislado en
`functions/lib/storage.ts` para poder volver a R2 cambiando un solo archivo.

**La velocidad se aplica en el reproductor**, no en la API: un mismo audio
generado sirve para todas las velocidades y el cambio es instantáneo.

**Renderer de EPUB propio en vez de `epub.js`.** epub.js dibuja cada capítulo
dentro de un iframe, lo que hace muy difícil resaltar la oración que se está
leyendo. Acá el XHTML se parsea, se sanitiza y se renderiza en el documento
principal, con cada oración envuelta en un `<span data-sentence>`.

**Login con Google Identity Services en modo popup**, no redirect: un redirect
saca a la PWA instalada del modo standalone en Android/iOS.

## Puesta en marcha

### 1. Google Cloud — credenciales OAuth

1. Entrá a [console.cloud.google.com](https://console.cloud.google.com/) y creá
   (o elegí) un proyecto.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**: tipo *External*,
   completá nombre de la app y correo de soporte.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de
   OAuth**, tipo **Aplicación web**.
4. En **Orígenes autorizados de JavaScript** agregá:
   - `http://localhost:5173` y `http://127.0.0.1:8788` (desarrollo)
   - `https://<tu-proyecto>.pages.dev` (y tu dominio propio, si tenés)

   No hace falta configurar URIs de redirección: el flujo es por popup.
5. Copiá el **Client ID**. El *client secret* no se usa.

### 2. Cloudflare — base, bucket y secretos

```bash
npm install

# Base de datos
npx wrangler d1 create reader-tts        # copiá el database_id a wrangler.toml
npm run db:remote                        # aplica schema.sql en producción

# Almacenamiento de archivos
npx wrangler kv namespace create FILES   # copiá el id a wrangler.toml
```

Poné el Client ID en `wrangler.toml`:

```toml
[vars]
GOOGLE_CLIENT_ID = "xxxxx.apps.googleusercontent.com"
```

Y cargá los secretos (nunca van al repo):

```bash
openssl rand -base64 32   # usá la salida para cada uno
npx wrangler pages secret put SESSION_SECRET
npx wrangler pages secret put ENCRYPTION_KEY   # debe decodificar a 32 bytes
```

### 3. Desplegar

```bash
npm run pages:deploy
```

En el panel de Cloudflare Pages, conectá el repo si preferís deploy automático
por push. Acordate de replicar `GOOGLE_CLIENT_ID`, `SESSION_SECRET` y
`ENCRYPTION_KEY` en las variables del proyecto, y de asociar los bindings `DB`
(D1) y `FILES` (KV).

### 4. Configurar la app

Entrá, iniciá sesión con Google y andá a **Ajustes**:

1. Pegá tu API key de [openrouter.ai/keys](https://openrouter.ai/keys).
2. Elegí el **modelo de TTS**. La lista se arma en tiempo real con los modelos
   de OpenRouter que generan audio; el default es `google/chirp-3`. Si ese slug
   no acepta síntesis, elegí otro de la lista sin tocar código.
3. Elegí la **voz** y probala con *Probar voz* antes de empezar un libro.

## Desarrollo

```bash
npm run db:local        # aplica el esquema en la D1 local
cp .dev.vars.example .dev.vars   # completá los valores
npm run pages:dev       # build + wrangler pages dev en :8788
```

Para iterar sobre la interfaz con recarga en caliente, `npm run dev` levanta
Vite en `:5173` y hace proxy de `/api` al `wrangler pages dev` de arriba (los dos
a la vez).

```bash
npm test          # unit tests
npm run build     # typecheck + build de producción
```

## Estructura

```
functions/            Cloudflare Pages Functions (backend)
  api/
    auth/session.ts   login con Google, sesión y logout
    books/            listado, subida, descarga, portada, progreso
    settings.ts       preferencias y API key cifrada
    tts/              proxy de síntesis + lista de modelos
  lib/                cripto, sesión, verificación de tokens de Google
src/
  lib/
    epub.ts           parser de EPUB (container, OPF, spine, ToC, portada)
    segmenter.ts      oraciones (Intl.Segmenter) y chunks
    annotate.ts       mapea oraciones sobre el DOM renderizado
    player.ts         reproducción, prefetch, seguimiento de oración
    tts.ts            motores OpenRouter y Web Speech
    store.ts          caché en IndexedDB (libros, archivos, audio, progreso)
  pages/              Login, Library, Reader, Settings
  i18n/               es.json / en.json
shared/types.ts       tipos compartidos entre front y functions
```

## Límites conocidos

- Subida máxima de 25 MB por EPUB (tope de un valor en KV).
- El texto se manda a OpenRouter en fragmentos de ~900 caracteres; libros muy
  largos generan muchas llamadas, y el costo lo define el modelo que elijas.
- La voz del navegador (Web Speech) es el respaldo sin conexión o sin API key:
  no requiere cuenta pero suena bastante peor.
- Solo se soporta EPUB. PDF y MOBI quedan fuera.
