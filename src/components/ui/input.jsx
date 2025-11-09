// src/components/ui/input.jsx 
// Styled input field with focus ring and border transition.

import React from 'react';

export function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={
        `rounded-md border px-3 py-2 outline-none transition 
         focus:ring-2 focus:ring-green-500 focus:border-green-500 ` + className
      }
    />
  );
}
export default Input;
