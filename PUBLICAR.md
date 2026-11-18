# Publicar cmtool-core en npm

Se publica **solo, con GitHub Actions, al subir una etiqueta de versión** (`v0.18.0`). El CLI (`cmtool-cli`) y el Backoffice B2C dependen del núcleo, así que **el núcleo siempre se publica primero**. Esta guía no se incluye en el paquete: npm solo sube lo que dice `files` en `package.json`.

## Cómo funciona

| Workflow | Cuándo corre | Qué hace |
| --- | --- | --- |
| [ci.yml](.github/workflows/ci.yml) | cada push a `main` y cada pull request | `check` (tipos, lint y tests), `build` y `npm pack --dry-run` |
| [release.yml](.github/workflows/release.yml) | al subir una etiqueta `vX.Y.Z`, o al crear un Release en GitHub con una etiqueta nueva | revisa que la etiqueta sea la versión de `package.json` y, si esa versión no está ya en npm, `npm publish` con trusted publishing |

`npm publish` corre antes `prepublishOnly` (el `check`, así que si un test falla no se publica) y `prepack` (el `build`, que borra `dist/` y lo vuelve a generar). Con trusted publishing, npm agrega sola la *provenance*: en la página del paquete se ve de qué commit y de qué workflow salió cada versión.

El paquete es **público y sin scope**, con licencia **MIT** a nombre de Alejandro Dotor ([LICENSE](LICENSE)), y no tiene `"private": true`. [test/package.test.ts](test/package.test.ts) falla si cambia lo que se sube (solo `dist/` y el CHANGELOG) o si falta la licencia.

## Configuración (una sola vez)

La Action publica con **trusted publishing**: npm confía en este workflow (`release.yml`, environment `prod`, repo `alejandrodotor8/cmtool-core`) y no hace falta ningún token. Pero npm solo deja configurarlo **para un paquete que ya existe**, así que la primera versión se publica a mano:

1. **La primera versión, desde tu terminal**, en la carpeta de este repo y con la versión de la etiqueta (`v0.17.0`):

   ```bash
   npm login          # y comprueba con npm whoami
   npm publish        # corre check y build antes de subir; npm te pide tu verificación en dos pasos
   ```

2. **Sube la etiqueta de esa versión** (`git push origin v0.17.0`). La Action ve que ya está en npm y no hace nada.
3. **Justo antes de publicar la segunda versión, registra la Action como trusted publisher** (pide tu verificación en dos pasos):

   ```bash
   npm trust github cmtool-core --file release.yml --repo alejandrodotor8/cmtool-core --env prod --allow-publish
   npm trust list cmtool-core   # para revisarlo
   ```

   **No lo hagas antes:** npm borra un trusted publisher nuevo si no publica nada en los 2 días siguientes. Regístralo y, ese mismo día, sube la etiqueta de la versión nueva. Desde ahí la Action publica sola, siempre.

   Es lo mismo que en npmjs.com → `cmtool-core` → *Settings* → *Trusted Publisher* → *GitHub Actions*, con *Allowed actions*: `npm publish`. **`--allow-publish` es necesario**: sin él, npm solo deja que el workflow prepare la publicación (`npm stage publish`) y que tú la apruebes.

No uses un token con *bypass 2FA*: npm ya no deja que esos tokens publiquen directo (responde `EOTP`), y van a perder ese permiso del todo. Si ya creaste uno para esto, bórralo en npmjs.com (*Access Tokens*) y el secreto `NPM_TOKEN` del environment `prod` en GitHub: el workflow ya no lo usa.

**El push, desde este equipo**, entra con la llave SSH de `alejandrodotor8`: el remoto es `git@github-alejandrodotor8:alejandrodotor8/cmtool-core.git`, con el alias de `~/.ssh/config` (que no usa el agente, para no entrar con la llave de Pragma). En otro equipo basta `git@github.com:alejandrodotor8/cmtool-core.git` con tu llave.

## Cada versión

1. **CHANGELOG y versión.** Agrega una entrada en [CHANGELOG.md](CHANGELOG.md) y sube la versión: menor si es una funcionalidad, de parche si es una corrección.

   ```bash
   bun pm version 0.18.0 --no-git-tag-version   # o: npm version 0.18.0 --no-git-tag-version
   ```

2. **Revisa que todo pase**: `bun run check`.
3. **Commit y push a `main`** (corre el CI):

   ```bash
   git commit -am "Versión 0.18.0: …"
   git push
   ```

4. **Publica subiendo la etiqueta:**

   ```bash
   git tag v0.18.0
   git push origin v0.18.0
   ```

   La Action *Publicar en npm* aparece en la pestaña *Actions* del repo. También puedes crear un Release en GitHub con la etiqueta `v0.18.0`, y así quedan las notas de la versión.
5. **Verifica**: `npm view cmtool-core version` debe mostrar la versión nueva.
6. **Actualiza a quien la use**: en el CLI, `bun add -d -E cmtool-core@0.18.0`; en el Backoffice, `bun add -E cmtool-core@0.18.0`.

## Publicar desde tu terminal

Si la Action no está disponible:

```bash
npm login                 # y comprueba con npm whoami
npm pack --dry-run        # solo dist/, README.md, CHANGELOG.md, LICENSE y package.json (66 archivos, ~51 kB)
npm publish               # corre check y build antes de subir; con verificación en dos pasos pide un código
```

Para probar el paquete como lo recibe otra persona, antes de publicar:

```bash
npm pack --pack-destination /tmp
mkdir /tmp/prueba-core && cd /tmp/prueba-core && npm init -y && npm pkg set type=module
npm install /tmp/cmtool-core-0.18.0.tgz
node -e "import('cmtool-core').then((m) => console.log(Object.keys(m).length, 'funciones y constantes'))"
```

En Windows (PowerShell), usa `$env:TEMP` en lugar de `/tmp`.

## Si algo sale mal

En la Action, el error está en el paso que falló: *Actions* → la ejecución → *Publicar en npm* (para ver el log hay que entrar a GitHub). Después de corregirlo, *Re-run jobs* vuelve a correrla con la misma etiqueta; si la versión ya se publicó, no hace nada.

| Mensaje | Qué pasa | Qué hacer |
| --- | --- | --- |
| `La etiqueta v… no coincide con la versión de package.json` | subiste la etiqueta sin subir la versión, o al revés | borra la etiqueta (`git push --delete origin v0.18.0 && git tag -d v0.18.0`), corrige y vuelve a etiquetar |
| `ENEEDAUTH`, `E401` o `E404` … `PUT` en la Action | npm no reconoce el workflow: falta el trusted publisher, o no coincide con el repo, el archivo (`release.yml`) o el environment (`prod`) | `npm trust list cmtool-core` y corrígelo (paso 2 de la configuración) |
| `E403` … `stage` en la Action | el trusted publisher solo permite `npm stage publish` | vuelve a crearlo con `--allow-publish` |
| `EOTP` en la Action | se está usando un token en vez de trusted publishing | quita el token (y el secreto `NPM_TOKEN`) y configura el trusted publisher |
| un error de *provenance* sobre `repository` | `repository.url` de `package.json` no es este repo de GitHub | corrígelo |
| `403` … `You do not have permission to publish` | el nombre ya es de otra cuenta | cambia el nombre |
| `403` … `cannot publish over the previously published versions` | esa versión ya existe | sube la versión: una versión publicada no se puede reemplazar |
| `EOTP` (en tu terminal) | tu cuenta pide un código de verificación | `npm publish --otp <código>` |

**Retirar una versión.** `npm deprecate cmtool-core@0.18.0 "usa la 0.18.1"` avisa a quien la instale, sin romperle nada a nadie. `npm unpublish cmtool-core@0.18.0` la borra, pero solo en las primeras 72 horas y si ningún otro paquete depende de ella. Después de borrarla, ese número de versión ya no se puede volver a usar.
