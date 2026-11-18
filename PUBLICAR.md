# Publicar cmtool-core en npm

Se publica **solo, con GitHub Actions, al subir una etiqueta de versión** (`v0.18.0`). El CLI (`cmtool-cli`) y el Backoffice B2C dependen del núcleo, así que **el núcleo siempre se publica primero**. Esta guía no se incluye en el paquete: npm solo sube lo que dice `files` en `package.json`.

## Cómo funciona

| Workflow | Cuándo corre | Qué hace |
| --- | --- | --- |
| [ci.yml](.github/workflows/ci.yml) | cada push a `main` y cada pull request | `check` (tipos, lint y tests), `build` y `npm pack --dry-run` |
| [release.yml](.github/workflows/release.yml) | al subir una etiqueta `vX.Y.Z`, o al crear un Release en GitHub con una etiqueta nueva | revisa que la etiqueta sea la versión de `package.json`, y `npm publish --provenance --access public` |

`npm publish` corre antes `prepublishOnly` (el `check`, así que si un test falla no se publica) y `prepack` (el `build`, que borra `dist/` y lo vuelve a generar). `--provenance` hace que npm muestre de qué commit y de qué workflow salió cada versión.

El paquete es **público y sin scope**, con licencia **MIT** a nombre de Alejandro Dotor ([LICENSE](LICENSE)), y no tiene `"private": true`. [test/package.test.ts](test/package.test.ts) falla si cambia lo que se sube (solo `dist/` y el CHANGELOG) o si falta la licencia.

## Configuración (una sola vez)

1. **El token de npm, como secreto de GitHub.** En npmjs.com → *Access Tokens* → *Generate New Token* (Granular):
   - *Permissions*: **Read and write**.
   - *Packages*: **All packages** la primera vez, porque `cmtool-core` todavía no existe; después puedes limitarlo a `cmtool-core` y `cmtool-cli`.
   - *Bypass two-factor authentication*: marcado, porque la Action no puede escribir un código.

   En este repo, en GitHub: *Settings* → *Environments* → *New environment* `prod` → *Add environment secret*: `NPM_TOKEN`. El workflow usa ese environment, así que el secreto solo lo ve la publicación.

   Los tokens vencen. Cuando pase, la publicación falla con `E401` o `E404`: crea otro y reemplaza el secreto.
2. **Mejor, sin token: *trusted publishing*.** Después de la primera publicación, en npmjs.com → `cmtool-core` → *Settings* → *Trusted Publisher* → *GitHub Actions*:

   | Campo | Valor |
   | --- | --- |
   | Organization or user | `alejandrodotor8` |
   | Repository | `cmtool-core` |
   | Workflow filename | `release.yml` |
   | Environment name | `prod` |

   Desde ahí npm acepta lo que publique ese workflow sin ningún token (ya tiene `id-token: write`), y puedes borrar el secreto `NPM_TOKEN`.
3. **El push, desde este equipo**, entra con la llave SSH de `alejandrodotor8`: el remoto es `git@github-alejandrodotor8:alejandrodotor8/cmtool-core.git`, y ese alias está en `~/.ssh/config`. En otro equipo basta `git@github.com:alejandrodotor8/cmtool-core.git` con tu llave.

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

En la Action, el error está en el paso que falló: *Actions* → la ejecución → *Publicar en npm*. Después de corregirlo, *Re-run jobs* vuelve a correrla con la misma etiqueta y el secreto actual.

| Mensaje | Qué pasa | Qué hacer |
| --- | --- | --- |
| `La etiqueta v… no coincide con la versión de package.json` | subiste la etiqueta sin subir la versión, o al revés | borra la etiqueta (`git push --delete origin v0.18.0 && git tag -d v0.18.0`), corrige y vuelve a etiquetar |
| `ENEEDAUTH` o `E401` | falta `NPM_TOKEN` en el environment `prod`, o venció | agrégalo o reemplázalo, y *Re-run jobs* |
| `E404` … `PUT` | el token no tiene permiso sobre el paquete, o el trusted publisher no coincide con el repo, el workflow o el environment | revisa los permisos del token o los datos del trusted publisher |
| un error de *provenance* sobre `repository` | `repository.url` de `package.json` no es este repo de GitHub | corrígelo |
| `403` … `You do not have permission to publish` | el nombre ya es de otra cuenta | cambia el nombre |
| `403` … `cannot publish over the previously published versions` | esa versión ya existe | sube la versión: una versión publicada no se puede reemplazar |
| `EOTP` (en tu terminal) | tu cuenta pide un código de verificación | `npm publish --otp <código>` |

**Retirar una versión.** `npm deprecate cmtool-core@0.18.0 "usa la 0.18.1"` avisa a quien la instale, sin romperle nada a nadie. `npm unpublish cmtool-core@0.18.0` la borra, pero solo en las primeras 72 horas y si ningún otro paquete depende de ella. Después de borrarla, ese número de versión ya no se puede volver a usar.
