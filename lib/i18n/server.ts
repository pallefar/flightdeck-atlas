import { resolveLocale, type Locale } from "./index";

/** The locale for a server request: a saved preference if the caller has one
 * (none is stored yet), else the request's Accept-Language, else English.
 * The server has no <html lang> to read: it is the one that sets it. */
export function resolveRequestLocale(
  request: Request | Headers,
  options: { preference?: string | null } = {},
): Locale {
  const headers = request instanceof Headers ? request : request.headers;
  return resolveLocale({
    preference: options.preference,
    acceptLanguage: headers.get("accept-language"),
  });
}
