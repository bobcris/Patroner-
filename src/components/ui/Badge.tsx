/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'neutral' | 'dark' | 'success' | 'warning' | 'danger' | 'accent';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className = ''
}) => {
  const sizes = {
    sm: 'text-[10px] px-1.5 py-0.5 tracking-wider font-mono font-medium',
    md: 'text-xs px-2.5 py-1 tracking-wide font-mono font-medium'
  };

  const variants = {
    neutral: 'bg-neutral-100 text-neutral-800 border border-neutral-200',
    dark: 'bg-neutral-900 text-neutral-100 border border-neutral-700',
    success: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border border-amber-200',
    danger: 'bg-rose-50 text-rose-800 border border-rose-200',
    accent: 'bg-stone-100 text-stone-900 border border-stone-300'
  };

  return (
    <span className={`inline-flex items-center gap-1 uppercase rounded-xs ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};
