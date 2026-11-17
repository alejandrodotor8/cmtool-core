/** Tipos de Contentful con nombres cortos, y estructuras propias de la herramienta. */
import type {
  AssetProps,
  ContentFields,
  ContentTypeProps,
  EditorInterfaceProps,
  EntryProps,
  PlainClientAPI,
  SpaceProps,
  TagProps,
} from 'contentful-management';

export type Cma = PlainClientAPI;
export type Space = SpaceProps;
export type Entry = EntryProps;
export type Asset = AssetProps;
export type ContentType = ContentTypeProps;
export type Field = ContentFields;
export type Tag = TagProps;
/** Apariencia del editor de un content type: widget y ajustes (como el help text) de cada campo. */
export type EditorInterface = EditorInterfaceProps;
export type EditorControl = NonNullable<EditorInterface['controls']>[number];
export type TagLink = NonNullable<Entry['metadata']>['tags'][number];

/** La cuenta de Contentful con la que se trabaja: separa respaldos e historial. */
export interface Account {
  userId: string;
  email: string | undefined;
  /** Host del CMA (región): api.contentful.com o api.eu.contentful.com. */
  host: string;
}

export interface Environment {
  id: string;
  /** Aliases que apuntan a este ambiente (por ejemplo, `master`). */
  aliases: string[];
}

export interface Locales {
  codes: Set<string>;
  default: string | undefined;
  /** Locales que no permiten campos vacíos: los obligatorios deben tener valor ahí (incluye el por defecto). */
  required: Set<string>;
}

/** Entries leídas en origen a partir de las que pegaste, con sus hijos. */
export interface EntryTree {
  entries: Map<string, Entry>;
  children: Map<string, string[]>;
  /** Entries a las que solo apunta un texto enlazado en un rich text (no se recorren ni se migran). */
  hyperlinks: Map<string, string[]>;
  /** Links a entries que no existen en origen. */
  broken: Set<string>;
}
