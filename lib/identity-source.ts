// Who may set the oai-authenticated-user-* identity headers.
//
// Only two front doors own them: the Sites hosting dispatcher, which a
// deployment declares with the secret ATLAS_DEPLOYMENT=hosted, and the vite
// dev shim (build/sites-vite-plugin.ts, `vite serve` only), which strips any
// inbound copy before it signs in the loopback fixture. A bare built Worker
// (`npm start`, self-hosting) has neither, so anyone could forge the headers:
// there the answer is false and the request is unauthenticated. Exact values
// only; anything else fails closed.
export const HOSTED_DEPLOYMENT = "hosted";

export function isIdentityHeaderTrusted({
  devShim,
  deployment,
}: {
  devShim: boolean;
  deployment: string | undefined;
}): boolean {
  return devShim === true || deployment === HOSTED_DEPLOYMENT;
}
