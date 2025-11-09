// src/components/ui/badge.jsx 
// Small pill-style label for statuses or categories.

export function Badge({ className = '', variant, children, ...props }) {
  const base = "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium";
  const styles =
    variant === 'outline'   ? "border border-white/20 text-gray-300" :
    variant === 'secondary' ? "bg-gray-100 text-gray-800" :
    "";
  return <span className={`${base} ${styles} ${className}`} {...props}>{children}</span>;
}
export default Badge;

