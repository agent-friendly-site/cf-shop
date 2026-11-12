/** Toast bus — one Toaster subscriber per page (admin-shell or upload). */

export type ToastVariant = "ok" | "bad";

export type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(items);
}

export function toast(message: string, variant: ToastVariant = "ok") {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  items = [...items, { id, message, variant }];
  emit();
  if (typeof window !== "undefined") {
    window.setTimeout(() => dismissToast(id), 4000);
  }
}

export function dismissToast(id: string) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}
