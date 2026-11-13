/** @jsxImportSource react */
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/app/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-accent text-foreground",
      outline: "border border-border",
      ok: "bg-emerald-100 text-emerald-900",
      warn: "bg-amber-100 text-amber-900",
      bad: "bg-red-100 text-red-900",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
