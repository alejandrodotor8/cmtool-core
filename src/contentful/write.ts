/**
 * Único módulo que escribe en Contentful.
 *
 * - Todo va al ambiente destino, que queda fijo al crear el writer: no hay forma de
 *   escribir en el origen.
 * - Solo crea y actualiza. No existe delete, archive ni unpublish.
 * - Lo único que publica son content types, porque Contentful lo exige para usar
 *   campos nuevos. Entries y assets quedan en draft.
 */
import type { Asset, Cma, ContentType, EditorInterface, Entry, Field, Tag, TagLink } from './types.ts';

export type Writer = ReturnType<typeof createWriter>;

export function createWriter(cma: Cma, { src, dst }: { src: string; dst: string }) {
  if (!dst || dst === src) throw new Error(`Ambiente destino inválido: "${dst}"`);
  const env = { environmentId: dst };
  const publishContentType = (ct: ContentType) => cma.contentType.publish({ ...env, contentTypeId: ct.sys.id }, ct);

  return {
    environment: dst,

    createTag: (tag: Tag) =>
      cma.tag.createWithId(
        { ...env, tagId: tag.sys.id },
        { name: tag.name, sys: { visibility: tag.sys.visibility ?? 'private' } },
      ),

    /** Crea el content type con el mismo ID y campos que en origen. Devuelve la versión publicada. */
    async createContentType(srcCT: ContentType): Promise<ContentType> {
      const { name, description, displayField, fields } = srcCT;
      const ct = await cma.contentType.createWithId(
        { ...env, contentTypeId: srcCT.sys.id },
        { name, description, displayField, fields },
      );
      return publishContentType(ct);
    },

    /** Agrega campos al final del content type de destino, sin tocar los existentes. */
    async addFields(dstCT: ContentType, fields: Field[]): Promise<ContentType> {
      const ct = await cma.contentType.update(
        { ...env, contentTypeId: dstCT.sys.id },
        { ...dstCT, fields: [...dstCT.fields, ...fields] },
      );
      return publishContentType(ct);
    },

    /**
     * Cambia las reglas de campos que ya existen (nombre, obligatorio, localizado,
     * validaciones) con `withRules(campoDeDestino)`. No agrega, quita ni cambia el tipo de
     * ningún campo. Devuelve la versión publicada.
     */
    async updateFieldRules(dstCT: ContentType, withRules: (field: Field) => Field): Promise<ContentType> {
      const fields = dstCT.fields.map((field) => {
        const updated = withRules(field);
        if (updated.id !== field.id || updated.type !== field.type) {
          throw new Error(`no se puede cambiar el ID ni el tipo del campo "${field.id}"`);
        }
        return updated;
      });
      const ct = await cma.contentType.update({ ...env, contentTypeId: dstCT.sys.id }, { ...dstCT, fields });
      return publishContentType(ct);
    },

    /**
     * Cambia el nombre, la descripción y el campo de título del content type, sin tocar sus
     * campos. Devuelve la versión publicada.
     */
    async updateContentTypeInfo(
      dstCT: ContentType,
      { name, description, displayField }: Pick<ContentType, 'name' | 'description' | 'displayField'>,
    ): Promise<ContentType> {
      const ct = await cma.contentType.update(
        { ...env, contentTypeId: dstCT.sys.id },
        { ...dstCT, name, description, displayField },
      );
      return publishContentType(ct);
    },

    /** Lee la apariencia del editor actual en destino y la actualiza con `build(actual)`. */
    async updateEditorInterface(contentTypeId: string, build: (current: EditorInterface) => EditorInterface) {
      const current = await cma.editorInterface.get({ ...env, contentTypeId });
      return cma.editorInterface.update({ ...env, contentTypeId }, build(current));
    },

    async createAsset(id: string, fields: Asset['fields']): Promise<void> {
      const asset = await cma.asset.createWithId({ ...env, assetId: id }, { fields });
      await cma.asset.processForAllLocales(env, asset);
    },

    createEntry: (id: string, contentTypeId: string, fields: Entry['fields'], tags: TagLink[]) =>
      cma.entry.createWithId({ ...env, entryId: id, contentTypeId }, { fields, metadata: { tags } }),

    /**
     * Lee la versión actual en destino y la actualiza con los campos y tags que devuelve
     * `build(actual)`. `beforeUpdate` recibe la versión actual antes de escribir (para
     * respaldarla); si falla, la entry no se actualiza.
     */
    async updateEntry(
      id: string,
      build: (current: Entry) => { fields: Entry['fields']; tags: TagLink[] },
      beforeUpdate?: (current: Entry) => void,
    ) {
      const current = await cma.entry.get({ ...env, entryId: id });
      beforeUpdate?.(current);
      const { fields, tags } = build(current);
      return cma.entry.update({ ...env, entryId: id }, { ...current, fields, metadata: { ...current.metadata, tags } });
    },
  };
}
