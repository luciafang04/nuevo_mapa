"use client";

import { Toaster as Sonner } from "sonner";

function Toaster() {
  return (
    <Sonner
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "border border-slate-200 bg-white text-slate-950 shadow-lg",
          description: "text-slate-600",
          actionButton: "bg-slate-950 text-white",
          cancelButton: "bg-slate-100 text-slate-950",
        },
      }}
    />
  );
}

export { Toaster };
