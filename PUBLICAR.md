# Publicar cmtool-core en npm

El CLI (`cmtool-cli`) y la web dependen del núcleo, así que **el núcleo siempre se publica primero**. Esta guía no se incluye en el paquete: npm solo sube lo que dice `files` en `package.json`.

## Antes de la primera vez

**Ya está decidido y hecho** (17 de noviembre de 2026):

- El paquete es **público y sin scope**: `cmtool-core`. Cualquiera puede instalarlo y leer su código.
- Tiene licencia **MIT**, a nombre de Alejandro Dotor ([LICENSE](LICENSE)), y `package.json` lo dice (`"license": "MIT"`).
- Ya no tiene `"private": true`, así que `npm publish` desde esta carpeta **publica de verdad**. En lugar de ese seguro, [test/package.test.ts](test/package.test.ts) falla si cambia lo que se sube (solo `dist/` y el CHANGELOG) o si falta la licencia, y `prepublishOnly` no deja publicar si un test falla.

Falta, una sola vez:

1. **Comprueba que el nombre siga libre**: `npm view cmtool-core` debe responder `404`; así estaba el 17 de noviembre de 2026. Si ya existe y no es tuyo, cambia el nombre aquí y en el CLI.
2. **Sube el repositorio** y agrega su dirección en `package.json`. Así los enlaces del README (como el del ejemplo) funcionan en la página de npm:

   ```json
   "repository": { "type": "git", "url": "git+https://github.com/<usuario>/cmtool-core.git" },
   "homepage": "https://github.com/<usuario>/cmtool-core#readme",
   "bugs": "https://github.com/<usuario>/cmtool-core/issues",
   ```

3. **Inicia sesión**: `npm login`, y comprueba la cuenta con `npm whoami`. Si tu cuenta tiene verificación en dos pasos (recomendado), npm te pide un código al publicar.

## Cada versión

1. **CHANGELOG y versión.** Agrega una entrada en [CHANGELOG.md](CHANGELOG.md) y sube la versión: menor si es una funcionalidad, de parche si es una corrección.

   ```bash
   bun pm version 0.18.0 --no-git-tag-version   # o: npm version 0.18.0 --no-git-tag-version
   ```

2. **Revisa que todo pase**: `bun run check`.
3. **Mira qué se va a publicar**:

   ```bash
   npm pack --dry-run
   ```

   Debe listar solo `dist/` (JavaScript y tipos), `README.md`, `CHANGELOG.md`, `LICENSE` y `package.json`. Hoy son 66 archivos y unos 51 kB. Si aparece `src/`, `test/` o algo con datos privados, detente y revisa `files` en `package.json`.
4. **Pruébalo como lo recibe otra persona.** Es opcional, pero recomendado en la primera publicación. En una carpeta temporal:

   ```bash
   npm pack --pack-destination /tmp
   mkdir /tmp/prueba-core && cd /tmp/prueba-core && npm init -y && npm pkg set type=module
   npm install /tmp/cmtool-core-0.18.0.tgz
   node -e "import('cmtool-core').then((m) => console.log(Object.keys(m).length, 'funciones y constantes'))"
   ```

   En Windows (PowerShell), usa `$env:TEMP` en lugar de `/tmp`.
5. **Publica**:

   ```bash
   npm publish
   ```

   Antes de subir el paquete, `npm publish` corre dos scripts. `prepublishOnly` corre el `check`, así que si un test falla no se publica. `prepack` corre el `build`, que borra `dist/` y lo vuelve a generar, así que nunca se sube uno viejo. Al no tener scope, se publica como público sin más flags. `bun publish` también sirve: usa la misma sesión de npm.
6. **Verifica**: `npm view cmtool-core version` debe mostrar la versión nueva.
7. **Guarda la versión en git** y súbela:

   ```bash
   git commit -am "Versión 0.18.0: …"
   git tag v0.18.0
   git push && git push --tags
   ```

8. **Actualiza quien la use.** En el CLI, sigue su `PUBLICAR.md`: primero se cambia la dependencia y después se publica el CLI.

## Si algo sale mal

| Mensaje | Qué pasa | Qué hacer |
| --- | --- | --- |
| `403` … `You do not have permission to publish` | el nombre ya es de otra cuenta | cambia el nombre |
| `403` … `cannot publish over the previously published versions` | esa versión ya existe | sube la versión: una versión publicada no se puede reemplazar |
| `EOTP` | tu cuenta pide un código de verificación | `npm publish --otp <código>` |
| `ENEEDAUTH` | no hay sesión de npm | `npm login` |

**Retirar una versión.** `npm deprecate cmtool-core@0.18.0 "usa la 0.18.1"` avisa a quien la instale, sin romperle nada a nadie. `npm unpublish cmtool-core@0.18.0` la borra, pero solo en las primeras 72 horas y si ningún otro paquete depende de ella. Después de borrarla, ese número de versión ya no se puede volver a usar.
