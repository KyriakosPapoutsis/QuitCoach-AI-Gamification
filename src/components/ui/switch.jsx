// src/components/ui/switch.jsx 
// Toggle switch styled component with custom track and thumb.

import React from 'react';

export function Switch({ checked = false, onCheckedChange, className = '' }) {
  const trackOnStyle = {
    // Use your app’s theme gradient/color instead of green
    background: 'var(--hero-grad)',
    borderColor: 'var(--hero-grad-first)',
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      className={
        `relative inline-flex h-6 w-11 items-center rounded-full transition border
         ${checked ? 'bg-transparent' : 'bg-gray-400/60 border-white/20'} ` + className
      }
      style={checked ? trackOnStyle : undefined}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition
          ${checked ? 'translate-x-5' : 'translate-x-1'}`}
      />
    </button>
  );
}
export default Switch;
