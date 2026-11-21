// Asset loaders: the only place that knows where files come from. A loader has
//   text(path) -> Promise<string>, bytes(path) -> Promise<Uint8Array>, json(path) -> Promise<any>
// with paths relative to its base. fetchLoader works in browsers and workers (and in Node for http URLs);
// nodeLoader reads the local file system and imports node:fs only when it is created.

const joinPath = (base, path) => (base.endsWith('/') ? base : base + '/') + path;

export function fetchLoader(baseUrl) {
  const get = async (path) => {
    const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
  };
  return {
    text: async (path) => (await get(path)).text(),
    bytes: async (path) => new Uint8Array(await (await get(path)).arrayBuffer()),
    json: async (path) => (await get(path)).json(),
  };
}

export async function nodeLoader(baseDir) {
  const fs = await import('node:fs/promises');
  return {
    text: (path) => fs.readFile(joinPath(baseDir, path), 'utf8'),
    bytes: async (path) => new Uint8Array(await fs.readFile(joinPath(baseDir, path))),
    json: async (path) => JSON.parse(await fs.readFile(joinPath(baseDir, path), 'utf8')),
  };
}
