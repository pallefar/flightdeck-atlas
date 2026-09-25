import type { MessageKey } from "./en";

/** Every German string below was written without a native reviewer (D-037
 * item 9 names one as still to come). Until one signs them off, they are
 * marked here; the typed Record keeps the key set equal to en.ts. */
export const DE_REVIEW_STATUS = "needs native review" as const;

export const de: Record<MessageKey, string> = {
  "onb.stage.not-confirmed": "Nicht bestätigt",
  "onb.stage.submitted": "Eingereicht",
  "onb.stage.linked": "Verknüpft",
  "onb.stage.setup-in-progress": "Einrichtung läuft",
  "onb.stage.setup-complete": "Einrichtung abgeschlossen",
  "onb.stage.needs-more-info": "Weitere Angaben nötig",
  "onb.stage.rejected": "Abgelehnt",
  "onb.stage.not-sent": "Nicht gesendet",
  "onb.stage.closed": "Senden geschlossen",
  "onb.timeline.aria": "FlightDeck-Status",
  "onb.tab.basics": "Grundlagen",
  "onb.tab.details": "FlightDeck-Details",
  "onb.tab.review": "Prüfen & senden",
  "onb.step.aria": "Onboarding-Schritte",
  "onb.step.apps": "Apps (optional)",
  "onb.step.agents": "KI-Agenten (gesperrt)",
  "onb.step.apps.note":
    "Apps für dieses Projekt können noch nicht ausgewählt werden. Der Schritt ist optional und zählt nie als Pflichtangabe.",
  "onb.step.agents.note":
    "KI-Agenten sind gesperrt und können noch nicht angefragt werden. Nichts in diesem Schritt wird gesendet oder gezählt.",
  "onb.step.back": "Zurück",
  "onb.step.next": "Weiter",
  "onb.meter.forYou": "{done} von {total} für Sie",
  "onb.meter.required": "{done} von {total} erforderlich",
  "onb.errors.title":
    "Bitte vervollständigen Sie diese Angaben, bevor Sie weitergehen:",
  "onb.check.last": "Zuletzt bei FlightDeck geprüft: {when}",
  "onb.check.never": "Noch nicht bei FlightDeck geprüft",
  "onb.check.note":
    "Atlas prüft FlightDeck nur, solange der Atlas-Super-Admin Atlas geöffnet hat.",
  "onb.reason.os_unreachable": "FlightDeck war nicht erreichbar.",
  "onb.reason.invalid_response": "FlightDeck hat unerwartet geantwortet.",
  "onb.reason.rate_limited": "FlightDeck war ausgelastet.",
  "onb.reason.already_submitted":
    "FlightDeck hat für dieses Projekt bereits eine Anfrage.",
  "onb.reason.invalid_submission":
    "FlightDeck hat das Format der Anfrage abgelehnt.",
  "onb.reason.unauthorized":
    "FlightDeck hat die Zugangsdaten von Atlas abgelehnt.",
  "onb.reason.refused":
    "Das Projekt-Onboarding ist in FlightDeck für Atlas nicht aktiviert, oder den Zugangsdaten von Atlas fehlt submit:proposal.",
  "onb.reason.invalid_payload":
    "Einige Angaben hatten nicht das vereinbarte Format.",
  "onb.reason.project_not_visible":
    "FlightDeck hat die Anfrage angenommen und legt das Projekt an; Atlas wartet, bis es aufgeführt wird.",
  "onb.reason.destination_not_shared":
    "FlightDeck hat die Anfrage in einen Workspace übernommen, der nicht mit Atlas geteilt ist, daher kann Atlas sie nicht bestätigen.",
  "onb.reason.credential_scope":
    "FlightDeck hat die Anfrage angenommen, aber den Zugangsdaten von Atlas fehlt read:context, daher sieht Atlas das Ergebnis nicht.",
  "onb.reason.lock_unreadable":
    "FlightDeck braucht einen Operator, der die Sperre dieser Anfrage prüft.",
  "onb.reason.idempotency_key_conflict":
    "FlightDeck führt den Schlüssel dieser Anfrage für ein anderes Atlas-Projekt, daher wurde nichts eingereicht.",
  "onb.reason.instance_unknown":
    "FlightDeck veröffentlicht seine Instanz-ID noch nicht, daher kann Atlas die Verknüpfung nicht speichern.",
  "onb.reason.link_conflict":
    "Dieses FlightDeck-Projekt ist bereits anderweitig verknüpft, daher hat Atlas es nicht verknüpft.",
  "onb.reason.submission_not_found": "FlightDeck kennt diese Anfrage nicht.",
  "onb.reason.waiting_to_be_filed":
    "Gesendet, wartet darauf, dass FlightDeck sie ablegt.",
  "onb.reason.abandoned":
    "Der Atlas-Super-Admin hat sie geschlossen, bevor FlightDeck sie bestätigt hat.",
  "onb.reason.duplicate": "Sie doppelt eine andere Anfrage.",
  "onb.reason.out-of-scope": "Sie liegt außerhalb des Bereichs von FlightDeck.",
  "onb.reason.other": "Es wurde kein Grund angegeben.",
  "onb.headcount.<50": "Weniger als 50",
  "onb.headcount.50-249": "50 bis 249",
  "onb.headcount.250+": "250 oder mehr",
  "onb.headcount.unknown": "Unbekannt",
  "onb.summary.none":
    "Onboarding: noch kein Projekt gesendet. Bereiten Sie eines unter „To FlightDeck“ vor.",
  "onb.summary.line": "Onboarding: {parts}.",
  "onb.summary.sent": "{n} an FlightDeck gesendet",
  "onb.summary.linked": "{n} verknüpft",
  "onb.summary.moreInfo": "{n} brauchen weitere Angaben",
  "onb.summary.declined": "{n} abgelehnt",
  "onb.summary.awaiting": "{n} warten auf Bestätigung",
  "onb.summary.notSent": "{n} nicht gesendet",
  "onb.summary.closed": "{n} geschlossen, bevor FlightDeck bestätigt hat",
  "onb.promo.unavailable": "Der Onboarding-Status ist gerade nicht verfügbar.",
  "onb.promo.checking": "Onboarding-Status wird geprüft…",
  "onb.promo.open": "FlightDeck-Verbindung",
  "onb.promo.import": "Import aus FlightDeck: nicht aktiviert",
  "onb.context.ok.chip": "Verbunden (nur lesen)",
  "onb.context.ok.text":
    "verbunden (nur lesen). Die Seitenleiste spiegelt Ihre FlightDeck-OS-Workspace- und Projektlisten über die OS-Inbound-API.",
  "onb.context.workspace_not_found.text":
    "verbunden (nur lesen). Ihr gespeicherter Workspace ist nicht mehr mit Atlas geteilt; wählen Sie in der Seitenleiste einen anderen.",
  "onb.context.workspace_disabled.text":
    "verbunden (nur lesen). Der gewählte Workspace ist in FlightDeck deaktiviert.",
  "onb.context.checking.chip": "Wird geprüft",
  "onb.context.checking.text": "die FlightDeck-Inbound-API wird geprüft.",
  "onb.context.not_configured.chip": "Nicht konfiguriert",
  "onb.context.not_configured.text":
    "nicht konfiguriert. Legen Sie die FlightDeck-URL und die Inbound-Zugangsdaten in der Atlas-Serverkonfiguration fest.",
  "onb.context.not_permitted.chip": "Nur Super Admin",
  "onb.context.not_permitted.text":
    "die Listen (nur lesen) sieht nur der Atlas-Super-Admin, weil sie eine gemeinsame OS-Maschinen-Zugangsberechtigung nutzen.",
  "onb.context.os_unreachable.chip": "Nicht erreichbar",
  "onb.context.os_unreachable.text":
    "FlightDeck OS war nicht erreichbar. Die zuletzt bestätigten Listen bleiben sichtbar.",
  "onb.context.rate_limited.chip": "Ausgelastet",
  "onb.context.rate_limited.text":
    "FlightDeck hat Atlas gebeten, vor dem nächsten Lesen zu warten.",
  "onb.context.invalid_response.chip": "Unerwartete Antwort",
  "onb.context.invalid_response.text":
    "FlightDeck hat geantwortet, aber nicht im vereinbarten Kontext-Format.",
  "onb.context.check_failed.chip": "Nicht verfügbar",
  "onb.context.check_failed.text":
    "Atlas konnte den Kontext gerade nicht prüfen.",
  "onb.context.unauthorized.chip": "Abgelehnt",
  "onb.context.unauthorized.text":
    "FlightDeck hat die Inbound-Zugangsdaten von Atlas abgelehnt. Es wird nichts angezeigt.",
  "onb.row.draftPrepared": "Entwurf vorbereitet",
  "onb.row.notPrepared": "Nicht vorbereitet",
  "onb.autosave.label": "Automatisches Speichern",
  "onb.autosave.idle": "Alle Änderungen gespeichert (Revision {revision})",
  "onb.autosave.pending": "Änderungen noch nicht gespeichert",
  "onb.autosave.saving": "Wird gespeichert…",
  "onb.autosave.saved": "Gespeichert {time} (Revision {revision})",
  "onb.autosave.retrying":
    "Nicht gespeichert, neuer Versuch in {seconds} s",
  "onb.autosave.conflict":
    "Nicht gespeichert: Jemand anderes hat diesen Entwurf gespeichert",
  "onb.autosave.locked":
    "Nicht gespeichert: FlightDeck hält diesen Entwurf möglicherweise, daher bleibt er wie gesendet",
  "onb.autosave.refused": "Nicht gespeichert: {error}",
  "onb.autosave.basics":
    "Grunddaten noch nicht gespeichert: Jetzt speichern verwenden",
  "onb.autosave.saveNow": "Jetzt speichern",
  "onb.autosave.leave":
    "Einige Onboarding-Änderungen sind noch nicht gespeichert. Trotzdem verlassen und sie verlieren?",
  "onb.conflict.title": "Jemand anderes hat Revision {revision} gespeichert",
  "onb.conflict.recoveredTitle":
    "Nicht gespeicherte Änderungen von vor dem Neuladen",
  "onb.conflict.loading": "Die andere Version wird geladen…",
  "onb.conflict.unavailable":
    "Die andere Version konnte nicht geladen werden. Ihre Änderungen bleiben hier erhalten; Atlas versucht es erneut, wenn Sie wählen.",
  "onb.conflict.intro":
    "Ihre Änderungen bleiben in diesem Browser-Tab erhalten, bis Sie wählen. „Meine behalten“ setzt Ihre Werte wieder auf Revision {revision} und speichert sie; „Andere Version übernehmen“ verwirft Ihre Änderungen.",
  "onb.conflict.field": "Feld",
  "onb.conflict.yours": "Ihre Version",
  "onb.conflict.theirs": "Andere Version",
  "onb.conflict.empty": "(leer)",
  "onb.conflict.same": "Beide Versionen enthalten dieselben Werte.",
  "onb.conflict.keepMine": "Meine behalten (darüber anwenden)",
  "onb.conflict.useTheirs": "Andere Version übernehmen",
  "onb.readiness.label": "Reifegrad",
  "onb.card.title": "FlightDeck",
  "onb.card.prepare": "FlightDeck-Anfrage vorbereiten",
  "onb.card.prepare.text":
    "Bereiten Sie eine Anfrage vor, um dieses Projekt in FlightDeck einzurichten. Ein OS-Admin entscheidet; nichts wird automatisch erstellt.",
  "onb.card.continue": "Entwurf fortsetzen ({done} von {total} für Sie)",
  "onb.card.continue.text":
    "Ihr Entwurf ist in Atlas gespeichert. Nur der Atlas-Super-Admin sendet ihn an FlightDeck.",
  "onb.card.lastStage": "Letzte Sendung: {stage}",
  "onb.card.waitingSuperAdmin": "Wartet auf den Super-Admin",
  "onb.card.waitingSuperAdmin.text":
    "FlightDeck hat die Sendung noch nicht bestätigt. Der Atlas-Super-Admin wiederholt oder schließt sie.",
  "onb.card.waitingFlightDeck": "Wartet auf Prüfung in FlightDeck",
  "onb.card.waitingFlightDeck.text":
    "Ein OS-Admin entscheidet; nichts wird automatisch erstellt.",
  "onb.card.fix": "Anfrage korrigieren",
  "onb.card.fix.text":
    "FlightDeck hat weitere Informationen angefordert. Aktualisieren Sie den Entwurf; der Atlas-Super-Admin sendet ihn erneut.",
  "onb.card.created": "Projekt erstellt",
  "onb.card.created.text": "FlightDeck führt dieses Projekt jetzt.",
  "onb.card.open": "In FlightDeck öffnen",
  "onb.card.view": "Status anzeigen",
  "onb.card.close": "Schließen",
  "onb.card.rowLink": "FlightDeck-Karte",
};
