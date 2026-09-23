// Atlas-only (not part of the OS mirror): motion.ts reads the build-time kill
// switch `import.meta.env.VITE_FD_MOTION_OFF`, which Vite (under vinext)
// inlines. Next's global.d.ts declares ImportMetaEnv without an index
// signature, so the one key the layer reads is declared here.
interface ImportMetaEnv {
  readonly VITE_FD_MOTION_OFF?: string;
}
