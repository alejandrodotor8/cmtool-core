/**
 * La puerta de entrada para hablar con Contentful. `connect` abre una conexión con un token y
 * `connection.space(id)` abre un space. Lo que se lee (spaces, ambientes, modelos, idiomas,
 * apariencia del editor) se lee una sola vez por conexión: pedirlo otra vez devuelve lo mismo,
 * sin otra llamada. Si una lectura falla, se vuelve a intentar la próxima vez que se pida.
 *
 * La conexión solo lee. Escriben las migraciones (entryMigration, modelMigration,
 * assetMigration, backupRestore), cada una con un writer atado a su ambiente destino.
 */
import { type Credentials, createCma, type RequestListener } from './contentful/client.ts';
import {
  currentUser,
  listEnvironments,
  listSpaces,
  readContentTypes,
  readEditorInterfaces,
  readLocales,
} from './contentful/read.ts';
import type { Account, Cma, ContentType, EditorInterface, Environment, Locales, Space } from './contentful/types.ts';
import { remember } from './core/cache.ts';

export interface Connection {
  /** Host del CMA (la región): api.contentful.com o api.eu.contentful.com. */
  host: string;
  /** Los spaces a los que tiene acceso la cuenta. */
  spaces(): Promise<Space[]>;
  /** La cuenta del token: separa respaldos e historial. */
  account(): Promise<Account>;
  /** Un space. Con el mismo ID devuelve siempre el mismo objeto, con lo que ya leyó. */
  space(spaceId: string): SpaceConnection;
}

/** Un space: sus lecturas de siempre, guardadas, y el cliente para lo demás. */
export interface SpaceConnection {
  /** El cliente del CMA atado a este space, para lecturas que no están aquí (búsquedas, listas). */
  cma: Cma;
  environments(): Promise<Environment[]>;
  contentTypes(env: string): Promise<Map<string, ContentType>>;
  locales(env: string): Promise<Locales>;
  editorInterfaces(env: string): Promise<Map<string, EditorInterface>>;
}

export interface ConnectOptions {
  /** Se llama en cada petición a la API, sin datos sensibles (para contarlas o mostrarlas). */
  onRequest?: RequestListener;
}

/** Abre una conexión. El token solo se envía a un host de Contentful: con otro, se detiene (ver createCma). */
export function connect(credentials: Credentials, { onRequest }: ConnectOptions = {}): Connection {
  const host = credentials.host ?? 'api.contentful.com';
  const client = createCma(credentials, undefined, onRequest);
  const spaces = remember(() => listSpaces(client));
  const account = remember(async (): Promise<Account> => {
    const user = await currentUser(client);
    return { userId: user.id, email: user.email, host };
  });
  const opened = new Map<string, SpaceConnection>();

  return {
    host,
    spaces: () => spaces(''),
    account: () => account(''),
    space(spaceId) {
      const space = opened.get(spaceId) ?? openSpace(createCma(credentials, spaceId, onRequest));
      opened.set(spaceId, space);
      return space;
    },
  };
}

/** Un space a partir de un cliente que ya tienes, atado a ese space (por ejemplo, en los tests). */
export function openSpace(cma: Cma): SpaceConnection {
  const environments = remember(() => listEnvironments(cma));
  return {
    cma,
    environments: () => environments(''),
    contentTypes: remember((env) => readContentTypes(cma, env)),
    locales: remember((env) => readLocales(cma, env)),
    editorInterfaces: remember((env) => readEditorInterfaces(cma, env)),
  };
}
