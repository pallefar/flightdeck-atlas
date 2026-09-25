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
  // KI-Agenten-Voraussetzungen: Entwurf, wartet auf Prüfung durch den Owner.
  "onb.agents.heading": "Was vorliegen muss, bevor KI-Agenten angefragt werden können",
  "onb.agents.status.open": "Offen",
  "onb.agents.ownerLabel": "Zuständig: {owner}",
  "onb.agents.cap.bedrock": "Bedrock überhaupt nutzen",
  "onb.agents.cap.employeeData": "Agenten mit Beschäftigtendaten",
  "onb.agents.cap.studio": "In Studio definierte Agenten",
  "onb.agents.cap.cowork": "Von Cowork ausgeführte Agenten",
  "onb.agents.pre.providerDpaRegion":
    "AWS als Anbieter freigegeben, Auftragsverarbeitungsvertrag und Freigabe der Drittlandübermittlung sowie die Bedrock-Region",
  "onb.agents.pre.aiHold":
    "Der Stopp für KI-Funktionen (Roadmap-Phase 56) beantwortet oder Agenten davon ausgenommen",
  "onb.agents.pre.iam":
    "Die AWS-IAM-Rolle oder -Schlüssel mit minimalen Rechten eingerichtet",
  "onb.agents.pre.worksCouncil":
    "Die Entscheidung des Betriebsrats zu Agenten, die Beschäftigtendaten verarbeiten (§87 Abs. 1 Nr. 6 BetrVG)",
  "onb.agents.pre.retention":
    "Die Entscheidung von Legal zu Aufbewahrung und Drittlandübermittlung der an Agenten gesendeten Daten (D-033 Entscheidung 6)",
  "onb.agents.pre.ruling8":
    "Studio-Regel 8: Freigabe der Vorlage „Agent-Assistent“",
  "onb.agents.pre.promptWording":
    "Eine von einem Menschen freigegebene Änderung am Wortlaut des Cowork-Projekt-Setup-Prompts",
  "onb.agents.owner.owner": "Owner",
  "onb.agents.owner.ownerAndDpo": "Owner und Legal / Datenschutzbeauftragte:r",
  "onb.agents.owner.legal": "Legal",
  "onb.agents.owner.operator": "Betrieb",
  "onb.agents.owner.worksCouncil": "Betriebsrat",
  "onb.step.back": "Zurück",
  "onb.step.next": "Weiter",
  "onb.step.position": "Schritt {n} von {total}: {name}",
  "onb.meter.forYou": "{done} von {total} für Sie",
  "onb.meter.required": "{done} von {total} erforderlich",
  "onb.note.title": "Anmerkung der Prüfung",
  "onb.note.fields": "Zu prüfende Felder",
  "onb.step.flagged": "muss korrigiert werden",
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
  "onb.conn.checking": "Die FlightDeck-Verbindung wird geprüft…",
  "onb.conn.readSubmit": "Verbunden: kann Kontext lesen und Onboarding-Anfragen senden",
  "onb.conn.readOnly": "Verbunden: nur lesen",
  "onb.conn.submitOnly": "Verbunden: kann Onboarding-Anfragen senden, aber keinen Kontext lesen",
  "onb.conn.notConnected": "Nicht verbunden ({reason})",
  "onb.conn.reason.not_configured": "FlightDeck ist in Atlas nicht konfiguriert",
  "onb.conn.reason.unauthorized": "FlightDeck hat die Zugangsdaten von Atlas abgelehnt",
  "onb.conn.reason.os_unreachable": "FlightDeck war nicht erreichbar",
  "onb.conn.reason.rate_limited": "FlightDeck bittet Atlas zu warten; bitte gleich erneut versuchen",
  "onb.conn.reason.invalid_response": "FlightDeck hat unerwartet geantwortet",
  "onb.conn.reason.no_scope": "die Zugangsdaten haben keinen Atlas-Bereich",
  "onb.conn.reason.check_failed": "Atlas konnte die Verbindung nicht prüfen",
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
  "onb.prefill.checklist": "Vorschlag aus der Onboarding-Checkliste",
  "onb.prefill.atlas-project": "Aus dem Atlas-Projekt übernommen",
  "onb.prefill.starter": "Aus Vorlage {id}, Version {version}",
  "onb.starter.title": "Beginnen mit",
  "onb.starter.blank": "Leer beginnen",
  "onb.starter.meta": "{owner} · Version {version} · freigegeben {date}",
  "onb.starter.preview": "Übernehmen füllt diese Felder:",
  "onb.starter.nothing":
    "Jedes Feld, das diese Vorlage füllt, hat bereits einen Wert; es ändert sich nichts.",
  "onb.starter.apply": "Vorlage übernehmen",
  "onb.starter.applied": "Vorlage {name}, Version {version} übernommen.",
  "onb.starter.undo": "Rückgängig",
  "onb.card.rowLink": "FlightDeck-Karte",
  // Anfragen und Senden (onb-atlas-request-ui, Plan 2026-09-25 J3).
  "onb.ask.button": "Super-Admin bitten, Revision {revision} zu senden",
  "onb.ask.waiting": "Wartet auf den Super-Admin (Revision {revision})",
  "onb.ask.waiting.text":
    "Sie haben den Atlas-Super-Admin gebeten, Revision {revision} zu senden. Er wählt das Ziel und sendet; bis dahin wird nichts gesendet.",
  "onb.ask.changed": "Seit Ihrer Anfrage geändert: erneut anfragen",
  "onb.ask.changed.text":
    "Der Entwurf wurde geändert, nachdem Sie Revision {revision} angefragt haben. Fragen Sie erneut an, damit der Super-Admin sendet, was Sie jetzt sehen.",
  "onb.ask.withdraw": "Anfrage zurückziehen",
  "onb.ask.theirs.text":
    "{by} hat den Atlas-Super-Admin gebeten, Revision {revision} zu senden. Nur {by} oder der Super-Admin kann die Anfrage zurückziehen; bis der Super-Admin sendet, wird nichts gesendet.",
  "onb.ask.theirs.changed": "Seit der Anfrage von {by} geändert: erneut anfragen",
  "onb.ask.theirs.changed.text":
    "Der Entwurf wurde geändert, nachdem {by} Revision {revision} angefragt hat. Fragen Sie erneut an, damit der Super-Admin sendet, was Sie jetzt sehen.",
  "onb.ask.asked":
    "Der Super-Admin wurde gebeten, Revision {revision} zu senden. An FlightDeck wurde nichts gesendet.",
  "onb.ask.withdrawn":
    "Anfrage zurückgezogen. An FlightDeck wurde nichts gesendet.",
  "onb.ask.saveFirst":
    "Speichern Sie zuerst den Entwurf: Der Super-Admin sendet die gespeicherte Revision.",
  "onb.ask.notReady":
    "Vervollständigen Sie zuerst Ihre Angaben ({done} von {total} für Sie).",
  "onb.ask.failed":
    "Die Anfrage konnte nicht gespeichert werden. Versuchen Sie es erneut.",
  "onb.waiting.title": "Wartet auf Sie ({count})",
  "onb.waiting.row": "{by} bittet, Revision {revision} zu senden",
  "onb.waiting.changed": "Seit der Anfrage geändert",
  "onb.waiting.review": "Prüfen und senden",
  "onb.waiting.card": "Wartet auf Sie: Revision {revision} senden",
  "onb.diff.title": "Geändert seit Revision {revision}",
  "onb.diff.field": "Feld",
  "onb.diff.asked": "Angefragt (Revision {revision})",
  "onb.diff.now": "Jetzt (Revision {current})",
  "onb.diff.none":
    "Kein gesendetes Feld weicht von der angefragten Revision ab; nur die Revisionsnummer hat sich geändert.",
  "onb.diff.unknown":
    "Atlas hat keine Kopie von Revision {revision} behalten und kann die Änderungen nicht auflisten. Prüfen Sie jedes Feld unter „What will be sent“.",
  "onb.diff.empty": "(leer)",
  // Die Warteansicht (onb-atlas-status-timeline, Plan 2026-09-25 J4).
  "onb.observed.aria": "Was Atlas gesehen hat",
  "onb.observed.row": "{stage}: {seen}",
  "onb.observed.seen": "gesehen {when}",
  "onb.observed.before": "vor Beginn der Aufzeichnung",
  "onb.history.title": "Frühere Übermittlungen",
  "onb.history.revision": "Revision {n}",
  "onb.history.adopted": "Frühere Anfrage von FlightDeck",
  "onb.history.row": "{send}: {stage} ({seen}).",
  "onb.history.again": "Erneut gesendet als Revision {n}.",
  "onb.history.againAdopted": "Erneut gesendet.",
  "onb.outage": "FlightDeck ist seit {when} nicht erreichbar.",
  "onb.eta.one": "Wird in der Regel innerhalb von 1 Arbeitstag beantwortet.",
  "onb.eta.many":
    "Wird in der Regel innerhalb von {n} Arbeitstagen beantwortet.",
  "onb.check.seen": "Letzte Aktualisierung gesehen: {when}",
  "onb.check.seenNever": "Noch keine Aktualisierung gesehen",
  "onb.next.not-confirmed":
    "Als Nächstes: Der Atlas-Super-Admin sendet erneut oder schließt die Übermittlung.",
  "onb.next.submitted":
    "Als Nächstes: Ein OS-Admin prüft die Anfrage in FlightDeck.",
  "onb.next.linked": "Als Nächstes: FlightDeck richtet das Projekt ein.",
  "onb.next.setup-in-progress":
    "Als Nächstes: FlightDeck schließt die Einrichtung des Projekts ab.",
  "onb.next.setup-complete":
    "Als Nächstes: Im Projekt in FlightDeck arbeiten.",
  "onb.next.needs-more-info":
    "Als Nächstes: Den Entwurf aktualisieren und erneut um das Senden bitten.",
  "onb.next.rejected":
    "Als Nächstes: Nichts ist offen. Den Entwurf aktualisieren, um ihn erneut zu senden.",
  "onb.next.not-sent":
    "Als Nächstes: Beheben, was FlightDeck abgelehnt hat, dann erneut senden.",
  "onb.next.closed":
    "Als Nächstes: Der Entwurf ist wieder offen und kann erneut gesendet werden.",
  "pages.doc.tooNew": "Diese Seite braucht ein Atlas-Update",
  "pages.doc.unreadable": "Diese Seite kann nicht angezeigt werden",
  "decks.export.button": "Meine Präsentationen für FlightDeck exportieren",
  "decks.export.hint":
    "Die Datei enthält nur Ihre eigenen Präsentationen, deren Quellprojekte Sie noch öffnen können.",
  "decks.export.done": "{count} Präsentationen exportiert.",
  "decks.export.withheld":
    "{count} nicht exportiert: Ein Quellprojekt ist für Sie nicht mehr verfügbar, die Präsentation war nicht lesbar oder die Dateigrenze war erreicht. Sie stehen in der Datei unter \"withheld\".",
  "decks.export.failed": "Der Export ist fehlgeschlagen. Bitte erneut versuchen.",
};
