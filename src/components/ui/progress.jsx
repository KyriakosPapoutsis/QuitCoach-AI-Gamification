// src/components/ui/progress.jsx 
// Simple progress bar component with customizable fill width and color.

export function Progress({ value = 0, className = '', barClassName = '', barStyle = {} }) {
  return (
    <div className={`w-full rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full ${barClassName || "bg-green-500"}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, ...(barStyle || {}) }}
      />
    </div>
  );
}
export default Progress;

