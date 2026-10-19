const paths = Object.keys(import.meta.glob('/scenes/mtlx-library/**/*.mtlx', { query: '?raw', import: 'default' }));

export const MATERIAL_CATALOG = paths.sort().map((path) => {
  const relative = path.slice('/scenes/mtlx-library/'.length);
  const parts = relative.split('/');
  return {
    path: `.${path}`,
    group: parts.slice(0, -2).join('/') || parts[0] || 'MaterialX',
    label: parts.at(-1)!.replace(/\.mtlx$/, '').replace(/_/g, ' '),
  };
});