// src/components/ui/label.jsx 
// Standard text label for form elements.

export function Label({ className = '', children, ...props }) {
  return <label className={`text-sm font-medium ${className}`} {...props}>{children}</label>;
}
export default Label;
