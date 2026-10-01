"use client";
import { useState } from "react";
import { ChevronUp, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FLIGHTDECK_ADMIN_ID } from "@/lib/flightdeck/admin-card";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/react";

/** The signed-in person in the sidebar, as a menu. The "Admin app" entry is
 * the server's reserved FlightDeck Admin launcher card: /api/workspace only
 * includes it for a viewer the server decided may see it, so this component
 * adds no rule of its own and shows nothing when the card is absent. */
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

  async function loadAdminLink() {
    try {
      const r = await fetch("/api/workspace");
      if (!r.ok) return setAdminUrl(null);
      const body = (await r.json()) as {
        apps?: { id: string; url?: string }[];
      };
      setAdminUrl(
        body.apps?.find((a) => a.id === FLIGHTDECK_ADMIN_ID)?.url ?? null,
      );
    } catch {
      setAdminUrl(null);
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && void loadAdminLink()}>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
