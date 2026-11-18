# Changelog

Cada cambio sube la versión: una funcionalidad nueva o un cambio de comportamiento sube la versión menor (0.17.0 → 0.18.0); una corrección, la de parche (0.18.0 → 0.18.1).

Desde la 0.18.0, `cmtool-core` y `cmtool-cli` llevan siempre la misma versión: cada versión se publica en los dos, aunque uno no haya cambiado.

Hasta la 0.16.1, este código era parte del CLI `cfm` (hoy `cmtool-cli`). Lo que cambió antes está en el CHANGELOG y el historial de git de ese repositorio.

## 0.19.0 — 2026-11-18

Para mostrar campo por campo lo que hace una migración, también lo que no cambia.

### Agregado

- **`migrationFields`**: cómo quedaría cada campo de una entry en destino si se escribe. Trae los que cambian, los que siguen igual (`SAME`) y los que no se migran porque en destino tienen otro tipo (`skipped`). Sirve también para las entries que se crean (sin `dst`): cada campo con valor llega nuevo. `isFieldChange` dice si un campo cambia.
- **`tree.analysis.fields`**: ese reporte para cada entry del árbol, exista o no en destino. Se arma con lo que ya se leyó al analizar: no hace llamadas nuevas.
- **`describeAsset`** (nombre, archivo, tipo, medidas, peso y URL https de una imagen o archivo) y **`assetDetailText`** (`image/png · 800×600 · 120 KB`), para que el CLI y una web muestren lo mismo. También `formatBytes`.
- `assetIdsOf` es público: las imágenes y archivos que usa una entry.

### Cambiado

- `migrationChanges` sale de `migrationFields` (son sus campos que cambian), así la regla está en un solo lugar. El resultado es el mismo que antes.

## 0.18.0 — 2026-11-18

Una API más chica y fácil de leer: conectarse, elegir una migración y recorrer sus etapas. **Rompe la compatibilidad con 0.17** (ver *Cambiado*).

### Agregado

- **`connect`**, la puerta de entrada: abre la conexión con un token, y `connection.space(id)` abre un space que guarda lo que lee (ambientes, modelos, idiomas, apariencia del editor). Pedirlo otra vez no repite la llamada. `openSpace(cma)` hace lo mismo con un cliente que ya tienes.
- **Migraciones por etapas** (un *builder* por pasos): `entryMigration`, `modelMigration`, `assetMigration` y `backupRestore`. Cada etapa devuelve la siguiente (analizar → decidir → plan → escribir), así que el orden no se puede saltar, y volver atrás no repite lecturas. Solo `execute` escribe, con un writer atado a destino que crea la propia migración.
- `modelChoices`: los cambios de modelo que se pueden elegir, con cómo leerlos y escribirlos como el flag `--model`.
- `backupRestore` trae al núcleo la escritura del restore, que antes hacía el CLI.
- Tests: la conexión, las opciones de modelo y las cuatro migraciones de punta a punta, con un Contentful falso de varios ambientes ([test/migrations.test.ts](test/migrations.test.ts)). Y tres guardas nuevas: solo las migraciones crean un writer, `index.ts` dice explícitamente qué es público y no expone cómo se escribe.

### Cambiado

- **La API pública es explícita** ([src/index.ts](src/index.ts)), agrupada por para qué sirve, y pasa de 123 funciones y constantes a 73. Lo interno deja de ser público: `analyzeTree`, `completeAnalysis`, `buildPlan`, `executePlan`, `applyModelChanges`, `applyAssets`, `createWriter`, `classifyTree`, `readContentTypes`, `remember`… Las migraciones por etapas los reemplazan: el [README](README.md) y [examples/migrate.ts](examples/migrate.ts) muestran cómo.
- `Envs` (origen y destino) es un tipo público.
- El README cuenta la API de arriba abajo: conectarse, elegir la migración y recorrer sus etapas.

## 0.17.0 — 2026-11-17

Primera versión como paquete propio.

### Agregado

- **`cmtool-core`**: la lógica de `cfm` para migrar contenido de Contentful entre ambientes, sin pantalla: cliente, lecturas, comparación de modelos y de entries, plan, escritura, respaldo, restore y reportes. Funciona en Node y en el navegador; lo que necesita disco va aparte, en `cmtool-core/node`.
- Se compila a JavaScript con sus tipos (`dist/`) y se publica en npm como **paquete público, con licencia MIT** ([LICENSE](LICENSE)). Los pasos están en [PUBLICAR.md](PUBLICAR.md). [test/package.test.ts](test/package.test.ts) cuida que solo se suba `dist/` y que la licencia esté.
- **Se publica solo, con GitHub Actions**: [ci.yml](.github/workflows/ci.yml) revisa cada push y pull request, y [release.yml](.github/workflows/release.yml) publica en npm al subir una etiqueta `vX.Y.Z` (si coincide con la versión), con *provenance*. Repositorio: [github.com/alejandrodotor8/cmtool-core](https://github.com/alejandrodotor8/cmtool-core).
- `createCma` se niega a mandar el token a un host que no sea de Contentful. Antes solo lo revisaba el CLI; ahora cualquier herramienta que use el núcleo tiene la misma garantía.
- `createRecordingRunner`: un runner sin pantalla que guarda el resultado de cada escritura, para una web, un backend o los tests.
- `createBackup` arma el respaldo y avisa en cada cambio, sin decidir dónde se guarda. `startBackup`, `listBackups` y `readBackup` (en `cmtool-core/node`) los guardan en archivos, en la misma carpeta que usa `cfm`.
- Un ejemplo completo de uso, que revisa tsc: [examples/migrate.ts](examples/migrate.ts).
- Tests sobre el código fuente: solo el writer escribe y no puede borrar, archivar ni despublicar ([test/security.test.ts](test/security.test.ts)); el núcleo no usa Node (salvo `cmtool-core/node`), ni una terminal, ni nada de quien lo usa, y solo depende de `contentful-management` ([test/architecture.test.ts](test/architecture.test.ts)).

### Cambiado (respecto a `cfm` 0.16.1)

- Los reportes Markdown dicen "Generado el …" en vez de "Generado por cfm el …".
- Un conflicto de versión al escribir dice "vuelve a intentarlo" en vez de "vuelve a correr cfm".
