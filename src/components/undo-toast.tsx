"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; message: string; undo?: () => void | Promise<void> };
const UndoContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});

/** Shows "… · Undo" for 8 seconds. Lives in the app layout, so it survives a ticked task leaving the list. */
export function UndoToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((t: Omit<Toast, "id">) => setToast({ ...t, id: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    timer.current = setTimeout(() => setToast(null), 8000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  return (
    <UndoContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {toast && (
          <div role="status" className="pointer-events-auto flex items-center gap-4 rounded-xl bg-primary px-4 py-3 text-sm text-on-primary shadow-lg" data-testid="undo-toast">
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                disabled={busy}
                className="font-semibold underline underline-offset-2 disabled:opacity-60"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await toast.undo?.();
                  } finally {
                    setBusy(false);
                    setToast(null);
                  }
                }}
              >
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </UndoContext.Provider>
  );
}

export function useUndoToast() {
  return useContext(UndoContext);
}
