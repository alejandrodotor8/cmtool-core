# Changelog

Cada cambio sube la versión: una funcionalidad nueva o un cambio de comportamiento sube la versión menor (0.17.0 → 0.18.0); una corrección, la de parche (0.18.0 → 0.18.1).

Hasta la 0.16.1, este código era parte del CLI `cfm` (hoy `cmtool-cli`). Lo que cambió antes está en el CHANGELOG y el historial de git de ese repositorio.

## 0.17.0 — 2026-11-17

Primera versión como paquete propio.

### Agregado

- **`cmtool-core`**: la lógica de `cfm` para migrar contenido de Contentful entre ambientes, sin pantalla: cliente, lecturas, comparación de modelos y de entries, plan, escritura, respaldo, restore y reportes. Funciona en Node y en el navegador; lo que necesita disco va aparte, en `cmtool-core/node`.
- Se compila a JavaScript con sus tipos (`dist/`) y se publica en npm como **paquete público, con licencia MIT** ([LICENSE](LICENSE)). Los pasos están en [PUBLICAR.md](PUBLICAR.md). [test/package.test.ts](test/package.test.ts) cuida que solo se suba `dist/` y que la licencia esté.
- `createCma` se niega a mandar el token a un host que no sea de Contentful. Antes solo lo revisaba el CLI; ahora cualquier herramienta que use el núcleo tiene la misma garantía.
- `createRecordingRunner`: un runner sin pantalla que guarda el resultado de cada escritura, para una web, un backend o los tests.
- `createBackup` arma el respaldo y avisa en cada cambio, sin decidir dónde se guarda. `startBackup`, `listBackups` y `readBackup` (en `cmtool-core/node`) los guardan en archivos, en la misma carpeta que usa `cfm`.
- Un ejemplo completo de uso, que revisa tsc: [examples/migrate.ts](examples/migrate.ts).
- Tests sobre el código fuente: solo el writer escribe y no puede borrar, archivar ni despublicar ([test/security.test.ts](test/security.test.ts)); el núcleo no usa Node (salvo `cmtool-core/node`), ni una terminal, ni nada de quien lo usa, y solo depende de `contentful-management` ([test/architecture.test.ts](test/architecture.test.ts)).

### Cambiado (respecto a `cfm` 0.16.1)

- Los reportes Markdown dicen "Generado el …" en vez de "Generado por cfm el …".
- Un conflicto de versión al escribir dice "vuelve a intentarlo" en vez de "vuelve a correr cfm".
