/* App-wide UI services: toast, and the add/link panel's opener. */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { Source } from "../lib/ks";
import { op } from "../lib/store";
import type { Op } from "../lib/ks";

interface ToastAction {
  label: string;
  run: () => void;
}
interface ToastState {
  text: string;
  action?: ToastAction;
  on: boolean;
}

export interface AddRequest {
  linkKey?: string | null;
  query?: string;
  source?: Source | "manual";
}

export interface MergeRequest {
  key: string; // the sheet the action was opened from
}

interface Ui {
  toast: (text: string, action?: ToastAction) => void;
  run: (operation: Op, okText?: string) => Promise<void>;
  copy: (text: string) => Promise<void>;
  openAdd: (req: AddRequest) => void;
  closeAdd: () => void;
  addRequest: AddRequest | null;
  openMerge: (key: string) => void;
  closeMerge: () => void;
  mergeRequest: MergeRequest | null;
}

const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi outside UiProvider");
  return ui;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toastState, setToast] = useState<ToastState>({ text: "", on: false });
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  const [mergeRequest, setMergeRequest] = useState<MergeRequest | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const toast = useCallback((text: string, action?: ToastAction) => {
    setToast({ text, action, on: true });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast((t) => ({ ...t, on: false })), action ? 7000 : 3200);
  }, []);

  const run = useCallback(
    async (operation: Op, okText?: string) => {
      try {
        await op(operation);
        if (okText) toast(okText);
      } catch (err) {
        toast((err as Error).message || "Couldn't save that change.");
      }
    },
    [toast],
  );

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast(`Copied ${text}.`);
      } catch {
        toast("Clipboard is blocked here. Select the time and copy it by hand.");
      }
    },
    [toast],
  );

  const ui: Ui = {
    toast,
    run,
    copy,
    openAdd: (req) => {
      setMergeRequest(null); // one panel at a time
      setAddRequest({ ...req });
    },
    closeAdd: () => setAddRequest(null),
    addRequest,
    openMerge: (key) => {
      setAddRequest(null); // one panel at a time
      setMergeRequest({ key });
    },
    closeMerge: () => setMergeRequest(null),
    mergeRequest,
  };

  return (
    <UiContext.Provider value={ui}>
      {children}
      <div className={`toast${toastState.on ? " on" : ""}`} role="status" aria-live="polite">
        <span>{toastState.text}</span>
        {toastState.action && (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              toastState.action?.run();
              setToast((t) => ({ ...t, on: false }));
            }}
          >
            {toastState.action.label}
          </button>
        )}
      </div>
    </UiContext.Provider>
  );
}
