# cmtool-core

La lógica para migrar contenido de Contentful entre ambientes (por ejemplo, de `develop` a `qa`): leer, comparar, planear, escribir y respaldar. **No tiene pantalla:** no pregunta, no imprime y no depende de una terminal. Por eso la puede usar cualquier herramienta: el CLI `cfm` ([`cmtool-cli`](https://www.npmjs.com/package/cmtool-cli)), una web o un backend.

Las entries y las imágenes quedan en draft, y nada se borra nunca.

```bash
npm install cmtool-core     # o pnpm add, yarn add, bun add
```

Necesita Node 22.18 o superior (o un navegador moderno, para la entrada principal). Su única dependencia es `contentful-management`.

## Cómo se usa

Tres pasos: **conectarse**, elegir **una migración** y recorrer sus **etapas**. Cada etapa devuelve la siguiente, así que el orden no se puede saltar, y solo la última escribe.

```ts
import { connect, createBackup, createRecordingRunner, entryMigration } from 'cmtool-core';

// 1. Conectarse: el token solo va a hosts de Contentful.
const contentful = connect({ token });
const space = contentful.space(spaceId);

// 2. La migración: de qué ambiente a cuál.
const migration = entryMigration(space, { src: 'develop', dst: 'qa' });

// 3. Las etapas.
const tree = await migration.analyze([entryId]);            // el árbol de la entry (solo lee)
const review = await tree.review(tree.defaultUpdates());    // modelo, imágenes y tags (solo lee)
const choices = await review.modelChoices();                // qué cambios de modelo hacen falta
const plan = review.plan({ withAssets: true, picked: choices.all }); // qué se escribe (puro)

// Aquí tu herramienta muestra el plan y pide confirmación. Nada se escribió todavía.
if ((await plan.changesInDestination()).length) throw new Error('qa cambió: vuelve a analizar');

const account = await contentful.account();
const backup = createBackup(
  { kind: 'migrate', spaceId, src: 'develop', dst: 'qa', rootIds: [entryId], account },
  guardar, // se llama en cada cambio, con el respaldo completo
);
const fallas = await plan.execute({ backup, runner: createRecordingRunner(mostrarAvance) });
```

El ejemplo completo, que revisa tsc, está en [examples/migrate.ts](examples/migrate.ts).

- **Volver atrás no repite lecturas.** `connection.space(id)` guarda lo que lee (ambientes, modelos, idiomas, apariencia del editor), y cada etapa guarda su resultado para los mismos argumentos. La misma migración (mismo space, origen y destino) es siempre el mismo objeto.
- **Dónde se guarda el respaldo y cómo se muestra el avance lo decides tú.** `createBackup` llama a `guardar` en cada cambio (en una web, tu base de datos) y el runner avisa cada escritura. En Node, `startBackup` de `cmtool-core/node` guarda el respaldo en un archivo, en la misma carpeta que usa `cfm`.
- **El token, del lado del servidor.** En una web, conéctate en una ruta del servidor o una *server action*, nunca en el navegador.

## Las cuatro migraciones

| Migración | Qué hace | Etapas |
| --- | --- | --- |
| `entryMigration(space, envs)` | entries, cada una con sus hijos | `analyze(ids)` → `review(toUpdate)` → `plan({ withAssets, picked })` → `execute(tools)` |
| `modelMigration(space, envs)` | content types, campos, reglas y apariencia del editor, sin contenido | `analyze({ contentTypes })` → `plan(picked)` → `execute(tools)` |
| `assetMigration(space, envs)` | imágenes y archivos sueltos | `analyze(ids)` → `execute(tools)` |
| `backupRestore(space, data)` | deshacer una ejecución con su respaldo | `analyze()` → `execute(tools)` |

Cada etapa trae lo que hace falta para mostrar y decidir: `tree.candidates` (lo que ya existe y cambió), `review.analysis`, `choices.options`, `plan.gaps` (campos obligatorios que quedarán vacíos), `plan.isEmpty`… Las decisiones también se pueden recibir y escribir como en un flag (`'all'`, `'none'` o una lista): `tree.updateDecision`, `choices.decisionFor` y `choices.apply`.

La etapa de análisis de `modelMigration` solo lee, así que también sirve para comparar modelos.

## Lo demás de la API

Todo lo público está en [src/index.ts](src/index.ts), agrupado por para qué sirve. Lo que no está ahí es interno y puede cambiar sin aviso.

| Para | Qué usar |
| --- | --- |
| **Comparar** (solo lectura) | `compareModels`, `compareEntryFields`, `environmentStatus` |
| **Reportes Markdown** | `modelComparisonReport`, `entryComparisonReport`, `statusReport` |
| **Textos para cualquier pantalla** | `modelPickText`, `fieldStatusText`, `changedFieldsText`, `ctInfoText`… (sin colores) |
| **Buscar qué migrar** | `searchEntries`, `searchAssets`, `listEntries`, `fetchEntries`, `readTags`, y `space.cma` para lo demás |
| **Respaldo y avance** | `createBackup`, `createRecordingRunner` (y `startBackup`, `listBackups`, `readBackup` en `cmtool-core/node`) |
| **Utilidades** | `parseEntryIds`, `parseDecision`, `entryQueryParams`, `parseSince`, `sortEnvironments`, `looksLikeProduction`, `LIMITS` |
| **Errores** | `AbortError` (detenerse con un mensaje claro), `formatError` (nunca muestra el token) |

Los tipos de Contentful (`Entry`, `Asset`, `ContentType`, `Locales`…) se exportan con nombres cortos.

| Entrada | Dónde funciona | Qué tiene |
| --- | --- | --- |
| `cmtool-core` | Node y navegador | todo lo anterior |
| `cmtool-core/node` | solo Node | respaldos en archivos (`~/.ctf-migrate/backups/<cuenta>/`), los mismos que usa `cfm` |

**TypeScript:** usa `skipLibCheck: true` (Next.js y la mayoría de plantillas ya lo traen). Sin eso, tsc revisa los tipos de `contentful-management`, y esos fallan solos (les falta `type-fest`); los de `cmtool-core` no.

## Garantías

- **Solo las migraciones escriben**, en `execute`, con un writer atado al ambiente destino que se niega si es igual al origen. La API pública no expone el writer, y no hay forma de borrar, archivar ni despublicar. Solo se publican content types, porque Contentful lo exige para usar campos nuevos.
- **Nada se escribe al analizar ni al planear.** Y `plan.changesInDestination()` vuelve a mirar destino justo antes de escribir, para no escribir sobre algo que cambió mientras se revisaba.
- **El token solo va a Contentful:** `connect` y `createCma` se niegan a usar un host que no sea `api.contentful.com` o `api.eu.contentful.com`, y los mensajes de error nunca incluyen la petición.
- **Antes de actualizar una entry se guarda cómo estaba** en el respaldo; si guardar falla, no se actualiza.
- **Si una escritura falla, se sigue con las demás:** el runner la anota y `execute` devuelve la lista de fallas.

Estas reglas las verifican tests sobre el código fuente: [test/security.test.ts](test/security.test.ts) y [test/architecture.test.ts](test/architecture.test.ts). Este último también revisa que el núcleo no use Node (salvo `cmtool-core/node`), ni una terminal, ni nada de quien lo usa.

## Versiones

`cmtool-core` y `cmtool-cli` llevan **siempre la misma versión**: `cfm` 0.18.0 lleva adentro el núcleo 0.18.0. Lo que cambió en cada una está en el [CHANGELOG](CHANGELOG.md).

## Desarrollo

Es un repositorio independiente: no necesita el CLI ni la web para instalarse, compilarse ni probarse. Con tu gestor (`npm run …`, `pnpm …`, `yarn run …` o `bun run …`):

| Script | Qué hace |
| --- | --- |
| `check` | `typecheck` + `lint` + `test`: córrelo antes de cada commit |
| `typecheck` | revisa tipos con tsc, también del [ejemplo](examples/migrate.ts) |
| `lint` / `format` | lint y formato con Biome / aplica el formato |
| `test` | tests con `node:test`, sin red y con un HOME temporal ([test/setup.ts](test/setup.ts)) |
| `build` | compila a JavaScript y tipos en `dist/`, lo que se publica |

```text
src/
  index.ts           la API pública, explícita
  connection.ts      connect y openSpace: la conexión, con sus lecturas guardadas
  migrations/        las cuatro migraciones por etapas (lo único que crea un writer)
  analyze.ts, execute.ts   el análisis de entries y las fases de escritura
  contentful/        hablar con la API: cliente, lecturas y el writer (el único que escribe)
  core/              reglas puras: comparar, planear, transformar; sin red ni disco
  backup.ts, runner.ts     el respaldo y el avance de la escritura
  report/, text.ts   reportes Markdown y textos sin formato
  node/              solo Node: respaldos en archivos (cmtool-core/node)
```

- **Los tests corren el código fuente directo** (Node quita los tipos al vuelo): no hace falta compilar para probar. Usan objetos armados a mano y un Contentful falso en memoria, con varios ambientes, que registra cada llamada ([test/fixtures.ts](test/fixtures.ts)).
- **Para que Node ejecute los `.ts`:** los imports llevan la extensión `.ts`, solo sintaxis que se puede borrar (nada de `enum` ni `namespace`; tsc lo revisa con `erasableSyntaxOnly`) y los tipos se importan con `import type`.
- **Probarlo en el CLI sin publicarlo:** `bun run build && bun link` aquí, y `bun link cmtool-core` en el repo del CLI. Después de cada cambio, `bun run build` aquí.
- **Publicar:** ver [PUBLICAR.md](PUBLICAR.md).

## Licencia

[MIT](LICENSE) © 2026 Alejandro Dotor.
