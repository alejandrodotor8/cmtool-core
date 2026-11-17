/**
 * Lecturas que se hacen una sola vez por clave (un ambiente, un space, un análisis): la
 * segunda vez se devuelve la misma promesa. Si una lectura falla, se olvida, para que la
 * próxima vez se vuelva a intentar en vez de repetir el error.
 */
export function cache<T>(): (key: string, load: () => Promise<T>) => Promise<T> {
  // Una clave sin promesa (undefined) es una lectura olvidada: se vuelve a hacer.
  const saved = new Map<string, Promise<T> | undefined>();
  return (key, load) => {
    let pending = saved.get(key);
    if (!pending) {
      const started = load();
      pending = started;
      saved.set(key, started);
      started.catch(() => {
        if (saved.get(key) === started) saved.set(key, undefined);
      });
    }
    return pending;
  };
}

/** `load` envuelta para que cada clave se lea una sola vez (ver `cache`). */
export function remember<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const cached = cache<T>();
  return (key) => cached(key, () => load(key));
}
