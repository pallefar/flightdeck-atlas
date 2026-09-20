"use client";
import { useState } from "react";
import { CircleHelp } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
export default function FeatureHelp({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="feature-help"
            aria-label={`Help: ${title}`}
            onClick={(e) => {
              e.preventDefault();
              setOpen(true);
            }}
          >
            <CircleHelp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={8}
          className="feature-help-content"
        >
          <strong>{title}</strong>
          <span>{children}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
