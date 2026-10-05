"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronUp, Compass, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FLIGHTDECK_ADMIN_ID } from "@/lib/flightdeck/admin-card";
import { visionCardConfig } from "@/lib/flightdeck/vision-card";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/react";

/** Private launch decisions come from the current authorized workspace
 * response. Navigation forwards no Atlas credentials; the OS checks its own session. */
export default function AccountMenu({
  name,
  role,
  email,
}: {
  name: string;
  role: string;
  email?: string;
}) {
  const locale = useLocale();
  const [adminUrl, setAdminUrl] = useState<string | null>(null);
  const [visionUrl, setVisionUrl] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  function clearLinks() {
    pending.current?.abort();
    pending.current = null;
    setAdminUrl(null);
    setVisionUrl(null);
  }

  async function loadLinks() {
    clearLinks();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const r = await fetch("/api/workspace", { signal: controller.signal, cache: "no-store" });
      if (!r.ok) return;
      const body = (await r.json()) as {
        apps?: { id: string; url?: string }[];
        accountMenu?: { visionUrl?: string | null };
      };
      if (controller.signal.aborted || pending.current !== controller) return;
      setAdminUrl(
        body.apps?.find((a) => a.id === FLIGHTDECK_ADMIN_ID)?.url ?? null,
      );
      setVisionUrl(visionCardConfig(body.accountMenu?.visionUrl ?? undefined)?.url ?? null);
    } catch {
      if (!controller.signal.aborted && pending.current === controller) {
        setAdminUrl(null);
        setVisionUrl(null);
      }
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => open ? void loadLinks() : clearLinks()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="profile profile-button"
          aria-label={t("account.menu.aria", locale)}
        >
          <span className="avatar">
            {name
              .split(/\s+/)
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase() || "ME"}
          </span>
          <div>
            <strong>{name}</strong>
            <small>{role}</small>
          </div>
          <ChevronUp size={14} className="profile-chevron" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel>
          <strong>{name}</strong>
          <small className="block text-muted-foreground font-normal">
            {email ? `${email} · ${role}` : role}
          </small>
        </DropdownMenuLabel>
        {adminUrl && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={adminUrl} target="_blank" rel="noopener noreferrer">
                <ShieldCheck size={15} aria-hidden />
                {t("account.menu.admin", locale)}
              </a>
            </DropdownMenuItem>
          </>
        )}
        {visionUrl && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={visionUrl} target="_blank" rel="noopener noreferrer" title={t("account.menu.visionHint", locale)}>
                <Compass size={15} aria-hidden />
                {t("account.menu.vision", locale)}
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
