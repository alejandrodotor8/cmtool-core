# cmtool-core

La lógica para migrar contenido de Contentful entre ambientes (por ejemplo, de `develop` a `qa`): leer, comparar, planear, escribir y respaldar. **No tiene pantalla**: no pregunta, no imprime y no depende de una terminal. Por eso la puede usar cualquier herramienta: el CLI `cfm` (paquete [`cmtool-cli`](https://www.npmjs.com/package/cmtool-cli)), una web o un backend.

Las entries y los assets quedan en draft. Solo se publican content types, porque Contentful lo exige para usar campos nuevos.

## Instalar

```bash
npm install cmtool-core     # o pnpm add, yarn add, bun add
```

Única dependencia: `contentful-management`. Necesita Node 22.18 o superior, o un navegador moderno para la entrada principal.

**TypeScript:** usa `skipLibCheck: true` (Next.js y la mayoría de plantillas ya lo traen). Con `false`, tsc revisa los tipos de `contentful-management`, y esos fallan solos (les falta `type-fest`); los de `cmtool-core` no.

| Entrada | Dónde funciona | Qué tiene |
| --- | --- | --- |
| `cmtool-core` | Node y navegador | todo: cliente, lecturas, reglas, análisis, plan, escritura, respaldo, reportes |
| `cmtool-core/node` | solo Node | respaldos en archivos (`~/.ctf-migrate/backups/<cuenta>/`), los mismos que usa `cfm` |

## Cómo se usa

El flujo es siempre el mismo: **analizar** (solo lee) → **planear** (puro) → **confirmar** (tu pantalla) → **escribir**. Este es el ejemplo completo, que también revisa tsc: [examples/migrate.ts](examples/migrate.ts).

```ts
import {
  allPicks, analyzeTree, buildPlan, completeAnalysis, createBackup, createCma, createRecordingRunner,
  createWriter, currentUser, defaultUpdates, executePlan, modelOptions, readEditorInterfaces,
  updateCandidates, writtenContentTypes,
} from 'cmtool-core';

const cma = createCma({ token }, spaceId); // el token solo va a hosts de Contentful
const envs = { src: 'develop', dst: 'qa' };

// 1. Analizar (solo lectura)
const tree = await analyzeTree(cma, { ...envs, rootIds: [entryId] });
const analysis = await completeAnalysis(cma, tree, defaultUpdates(updateCandidates(tree)));

// 2. Planear (puro)
const options = modelOptions(analysis.diffs.values(), writtenContentTypes(analysis));
const plan = buildPlan(analysis, { withAssets: true, picked: allPicks(options) });

// 3. Mostrar el plan y confirmar: eso es de tu herramienta.

// 4. Escribir
const user = await currentUser(cma);
const backup = createBackup(
  { kind: 'migrate', spaceId, ...envs, rootIds: [entryId], account: { userId: user.id, email: user.email, host: 'api.contentful.com' } },
  (data) => guardar(data), // se llama en cada cambio: en una web, tu base de datos
);
const runner = createRecordingRunner((phases) => mostrarAvance(phases));
const fallas = await executePlan(plan, analysis, () => readEditorInterfaces(cma, envs.src), {
  writer: createWriter(cma, envs),
  backup,
  runner,
});
```

En Node, `startBackup` de `cmtool-core/node` hace lo mismo que `createBackup`, pero guarda en un archivo y devuelve su ruta.

## Lo que hay adentro

| Grupo | Funciones principales |
| --- | --- |
| **Cliente** | `createCma`, `CMA_HOSTS`, `CMA_HOST_NAMES`, `describeRequest` |
| **Lecturas** | `readEntryTree`, `readContentTypes`, `readLocales`, `readTags`, `readEditorInterfaces`, `searchEntries`, `searchAssets`, `listEntries`, `listSpaces`, `listEnvironments`, `currentUser`, `fetchEntries`, `fetchAssets` |
| **Escritura** | `createWriter` (el único que escribe, atado al ambiente destino) |
| **Migrar entries** | `analyzeTree`, `completeAnalysis`, `changesSinceAnalysis`, `updateCandidates`, `defaultUpdates`, `buildPlan`, `executePlan`, `requiredGaps`, `brokenHyperlinks` |
| **Modelo** | `compareModels`, `diffContentType`, `modelOptions`, `allPicks`, `modelChangesFrom`, `applyModelChanges`, `editorDifferences` |
| **Imágenes** | `applyAssets`, `assetFieldsForDestination` |
| **Comparar y estado** | `compareEntryFields`, `migrationChanges`, `environmentStatus` |
| **Respaldo y restore** | `createBackup`, `restoreStatus`, `shouldRestore`, `backupOwner` (y `startBackup`, `listBackups`, `readBackup` en `cmtool-core/node`) |
| **Avance de la escritura** | `Runner` (el contrato), `createRecordingRunner` (sin pantalla) |
| **Reportes y textos** | `modelComparisonReport`, `entryComparisonReport`, `statusReport` (Markdown) y textos sin formato para cualquier pantalla |
| **Utilidades** | `parseEntryIds`, `parseIds`, `parseDecision`, `entryQueryParams`, `parseSince`, `sortEnvironments`, `looksLikeProduction`, `remember`, `cache`, `LIMITS` |
| **Errores** | `AbortError` (detenerse con un mensaje claro), `formatError` (nunca muestra el token), `statusOf` |

Los tipos de Contentful (`Entry`, `Asset`, `ContentType`, `Locales`, `Cma`…) se exportan con nombres cortos.

## Garantías

- **Un solo módulo escribe** (`createWriter`): queda atado al ambiente destino, se niega si es igual al origen y no tiene forma de borrar, archivar ni despublicar. Solo publica content types.
- **El token solo va a Contentful**: `createCma` se niega a crear un cliente para otro host que no sea `api.contentful.com` o `api.eu.contentful.com`, y los mensajes de error nunca incluyen la petición.
- **Nada se escribe al analizar ni al planear**: solo `executePlan`, `applyModelChanges` y `applyAssets` escriben, y lo hacen a través del writer.
- **Antes de actualizar una entry se guarda cómo estaba** en el respaldo; si guardar falla, no se actualiza.
- **Si una escritura falla, se sigue con las demás**: el runner la anota y `executePlan` devuelve la lista de fallas.

Estas reglas las verifican tests sobre el código fuente: [test/security.test.ts](test/security.test.ts) y [test/architecture.test.ts](test/architecture.test.ts). Este último también revisa que el núcleo no use Node (salvo `cmtool-core/node`), ni una terminal, ni nada de quien lo usa.

## Desarrollo

Es un repositorio independiente: no necesita el CLI ni la web para instalarse, compilarse ni probarse. Con tu gestor (`npm run …`, `pnpm …`, `yarn run …` o `bun run …`):

| Script | Qué hace |
| --- | --- |
| `typecheck` | revisa tipos con tsc, también del [ejemplo](examples/migrate.ts) (no genera archivos) |
| `lint` / `format` | lint y formato con Biome / aplica el formato |
| `test` | tests (`node:test`): sin red y con un HOME temporal ([test/setup.ts](test/setup.ts)) |
| `check` | typecheck + lint + tests; córrelo antes de hacer commit |
| `build` | compila a JavaScript y tipos en `dist/`, lo que se publica |

Los tests corren el código fuente directo (Node quita los tipos al vuelo), así que no hace falta compilar para probar. Usan objetos armados a mano ([test/fixtures.ts](test/fixtures.ts)) y un CMA falso en memoria que registra cada llamada.

Reglas para que Node pueda ejecutar los `.ts` sin compilar: los imports llevan la extensión `.ts` (al compilar pasan a `.js`), solo sintaxis que se puede borrar (nada de `enum` ni `namespace`; tsc lo revisa con `erasableSyntaxOnly`) y los tipos se importan con `import type`.

**Probarlo en el CLI sin publicarlo**: compílalo y regístralo con `bun link`; en el repo del CLI, `bun link cmtool-core` hace que use esta carpeta. Después de cada cambio, `bun run build` aquí.

```bash
bun run build && bun link
```

**Publicar en npm**: ver [PUBLICAR.md](PUBLICAR.md). Cada cambio lleva su entrada en el [CHANGELOG](CHANGELOG.md) y sube la versión.

## Licencia

[MIT](LICENSE) © 2026 Alejandro Dotor.
