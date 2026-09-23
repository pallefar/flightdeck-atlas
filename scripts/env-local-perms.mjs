import { statSync } from "node:fs";

// .env.local holds ATLAS_FLIGHTDECK_INBOUND_TOKEN, so only its owner should be
// able to read or write it (mode 600). This returns a warning when group or
// others have any access, and null otherwise. It only reads the file's mode,
// never its contents. Warning only: the dev server still starts.
export function envLocalPermissionWarning(file) {
  if (process.platform === "win32") return null;
  let mode;
  try {
    mode = statSync(file).mode & 0o777;
  } catch {
    return null;
  }
  if ((mode & 0o077) === 0) return null;
  const octal = mode.toString(8).padStart(3, "0");
  return `Warning: ${file} has mode ${octal}; group or others can access it and it holds credentials. Run: chmod 600 "${file}"`;
}
