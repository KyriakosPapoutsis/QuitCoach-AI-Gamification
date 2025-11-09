// src/components/ui/card.jsx 
// Simple card layout container with header/title/content helpers.

export function Card({ className = '', children }) {
  return <div className={`rounded-xl border border-white/10 bg-white/5 ${className}`}>{children}</div>;
}
export function CardHeader({ className = '', children }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
export function CardTitle({ className = '', children }) {
  return <h3 className={`text-lg font-semibold ${className}`}>{children}</h3>;
}
export function CardContent({ className = '', children }) {
  return <div className={`p-4 pt-0 ${className}`}>{children}</div>;
}
export default Card;
