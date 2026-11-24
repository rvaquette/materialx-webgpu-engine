// The UMD build of dockview-core injects its stylesheet; the ESM build ships none.
declare module 'dockview-core/dist/dockview-core.js' {
  export * from 'dockview-core';
}
