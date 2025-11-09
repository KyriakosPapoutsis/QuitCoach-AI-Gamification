// src/components/ui/textarea.jsx 
// Styled multiline textarea field with focus ring.

export function Textarea({ className = '', ...props }) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border px-3 py-2 outline-none transition
                  focus:ring-2 focus:ring-green-500 focus:border-green-500 ${className}`}
    />
  );
}
export default Textarea;
