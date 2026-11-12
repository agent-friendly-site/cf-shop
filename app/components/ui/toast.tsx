/** @jsxImportSource react */
import * as ToastPrimitive from "@radix-ui/react-toast";
import { useEffect, useState } from "react";
import { cn } from "@/app/lib/utils";
import { dismissToast, subscribeToasts, type ToastItem } from "@/app/lib/toast";

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
      {items.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          open
          onOpenChange={(open) => {
            if (!open) dismissToast(t.id);
          }}
          className={cn(
            "fixed bottom-4 right-4 z-[100] w-[min(100%-2rem,22rem)] rounded-md border px-4 py-3 text-sm shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out",
            t.variant === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <ToastPrimitive.Title className="font-medium">{t.message}</ToastPrimitive.Title>
            <ToastPrimitive.Close className="shrink-0 text-xs underline opacity-70 hover:opacity-100">
              关闭
            </ToastPrimitive.Close>
          </div>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 outline-none sm:max-w-sm" />
    </ToastPrimitive.Provider>
  );
}
