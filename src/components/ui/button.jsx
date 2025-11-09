// src/components/ui/button.jsx 
// Reusable styled button component with disabled and active states.

export function Button({
  className = '',
  disabled,
  onClick,
  children,
  type = 'button',
  style,
  ...props
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={
        `inline-flex items-center justify-center text-white transition 
         disabled:opacity-50 disabled:cursor-not-allowed 
         active:brightness-90 ` + className
      }
      {...props}
    >
      {children}
    </button>
  );
}

export default Button;
