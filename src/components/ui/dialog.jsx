// src/components/ui/dialog.jsx 
// Basic modal dialog using React portal and overlay background.

import React, { useEffect } from "react";
import ReactDOM from "react-dom";

export function Dialog({ open, onOpenChange, children }) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* overlay (keep dim; not transparent content) */}
      <div
        className="fixed inset-0 bg-black/60"
        onClick={() => onOpenChange?.(false)}
      />
      {children}
    </div>,
    document.body
  );
}

export function DialogContent({ className = "", children }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={
        // solid background, smaller width, tighter padding
        "relative z-10 w-[360px] rounded-xl border border-white/15 " +
        "bg-neutral-900 p-4 shadow-xl " +
        className
      }
    >
      {children}
    </div>
  );
}

export function DialogHeader({ className = "", children }) {
  return <div className={`mb-2 ${className}`}>{children}</div>;
}

export function DialogTitle({ className = "", children }) {
  return (
    <h3 className={`text-white text-sm font-semibold leading-tight ${className}`}>
      {children}
    </h3>
  );
}
