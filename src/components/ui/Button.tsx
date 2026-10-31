/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const base = 'inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none tracking-tight';

  const sizes = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5 rounded-sm',
    md: 'text-sm px-4 py-2 gap-2 rounded-sm',
    lg: 'text-base px-5 py-2.5 gap-2.5 rounded-sm'
  };

  const variants = {
    primary: 'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-black shadow-xs',
    secondary: 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200 active:bg-neutral-300',
    outline: 'border border-neutral-300 text-neutral-900 hover:bg-neutral-50 active:bg-neutral-100',
    ghost: 'text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200',
    danger: 'bg-rose-700 text-white hover:bg-rose-800 active:bg-rose-900'
  };

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
};
