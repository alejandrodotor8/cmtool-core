# Publicar cmtool-core en npm

El CLI (`cmtool-cli`) y la web dependen del núcleo, así que **el núcleo siempre se publica primero**. Esta guía no se incluye en el paquete: npm solo sube lo que dice `files` en `package.json`.

## Antes de la primera vez

Se hace una sola vez.

1. **Decide si el código puede ser público.** Un paquete sin scope, como `cmtool-core`, es público: cualquiera lo instala y lee su código. Si no puede serlo, publícalo con el scope de una organización de npm (`@<organización>/cmtool-core`) y acceso restringido, que necesita un plan pago. En ese caso cambia el nombre aquí, en el CLI y en sus imports.
2. **Elige una licencia.** Agrega el archivo `LICENSE` y el campo `"license"` en `package.json`: `"MIT"` si es abierto, o `"UNLICENSED"` si nadie más puede usarlo. npm la muestra en la página del paquete.
3. **Comprueba que el nombre siga libre**: `npm view cmtool-core` debe responder `404`; así estaba el 17 de noviembre de 2026. Si ya existe y no es tuyo, cambia el nombre.
4. **Sube el repositorio** y agrega su dirección en `package.json`. Así los enlaces del README (como el del ejemplo) funcionan en la página de npm:

   ```json
   "repository": { "type": "git", "url": "git+https://github.com/<organización>/cmtool-core.git" },
   "homepage": "https://github.com/<organización>/cmtool-core#readme",
   "bugs": "https://github.com/<organización>/cmtool-core/issues",
   ```

5. **Quita `"private": true`** de `package.json`. Mientras esté, `npm publish` se niega: es el seguro para no publicar por error.
6. **Inicia sesión**: `npm login`, y comprueba la cuenta con `npm whoami`. Si tu cuenta tiene verificación en dos pasos (recomendado), npm te pide un código al publicar.

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

   Debe listar solo `dist/` (JavaScript y tipos), `README.md`, `CHANGELOG.md` y `package.json`, más `LICENSE` si lo agregaste. Hoy son 65 archivos y unos 50 kB. Si aparece `src/`, `test/` o algo con datos privados, detente y revisa `files` en `package.json`.
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

   Antes de subir el paquete, `npm publish` corre dos scripts. `prepublishOnly` corre el `check`, así que si un test falla no se publica. `prepack` corre el `build`, que borra `dist/` y lo vuelve a generar, así que nunca se sube uno viejo. Con un scope, la primera vez agrega `--access public` (o `--access restricted`). `bun publish` también sirve: usa la misma sesión de npm.
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
| `This package has been marked as private` | sigue `"private": true` | quítalo (paso 5 de la primera vez) |
| `403` … `You do not have permission to publish` | el nombre ya es de otra cuenta | cambia el nombre |
| `403` … `cannot publish over the previously published versions` | esa versión ya existe | sube la versión: una versión publicada no se puede reemplazar |
| `EOTP` | tu cuenta pide un código de verificación | `npm publish --otp <código>` |
| `402 Payment Required` | un paquete con scope y acceso restringido necesita un plan pago | `--access public`, o un plan de organización |
| `ENEEDAUTH` | no hay sesión de npm | `npm login` |

**Retirar una versión.** `npm deprecate cmtool-core@0.18.0 "usa la 0.18.1"` avisa a quien la instale, sin romperle nada a nadie. `npm unpublish cmtool-core@0.18.0` la borra, pero solo en las primeras 72 horas y si ningún otro paquete depende de ella. Después de borrarla, ese número de versión ya no se puede volver a usar.
