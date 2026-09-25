// Atlas's own reading of a PageDoc (not part of the lib/pagedoc mirror).
// parsePageDoc, from the mirrored OS tree, is the only way a doc is read; this
// adds what Atlas says to the reader when it cannot show one. A doc newer
// than this Atlas reads (the OS released a schema version before the Atlas
// mirror caught up) is 'too_new': "This page needs an Atlas update". An
// invalid or too-old doc is refused as a whole, never half-rendered.
import { t, type Locale } from "./i18n";
import {
  parsePageDoc,
  type PageDocFailureCode,
  type PageDocIssue,
  type PageDocV2,
} from "./pagedoc/schema/index.js";

export type AtlasPageDocRead =
  | { ok: true; doc: PageDocV2 }
  | { ok: false; code: PageDocFailureCode; message: string; issues: PageDocIssue[] };

export function readAtlasPageDoc(input: unknown, locale: Locale): AtlasPageDocRead {
  const r = parsePageDoc(input);
  if (r.ok) return r;
  const message = t(r.code === "too_new" ? "pages.doc.tooNew" : "pages.doc.unreadable", locale);
  return { ok: false, code: r.code, message, issues: r.issues };
}
