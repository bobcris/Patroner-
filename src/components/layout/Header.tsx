/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Badge } from '../ui/Badge';
import { Layers, ShieldCheck, Compass, Sparkles } from 'lucide-react';

export type WorkspaceTab = 'studio' | 'specification' | 'measurements' | 'pattern-cad' | 'production';

interface HeaderProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  isApproved: boolean;
  isDraftValid: boolean;
  activeDesignName: string;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  isApproved,
  isDraftValid,
  activeDesignName
}) => {
  return (
    <header className="border-b border-neutral-200 bg-white/90 backdrop-blur-md sticky top-0 z-40">
      {/* Top micro-bar */}
      <div className="px-4 lg:px-8 py-1.5 bg-neutral-900 text-neutral-300 text-[11px] font-mono flex items-center justify-between border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <span className="text-white font-semibold tracking-widest">PATRONER</span>
          <span className="text-neutral-500">//</span>
          <span className="text-neutral-400">FASHION DESIGN &amp; DETERMINISTIC PATTERN CAD</span>
          <span className="hidden sm:inline-block px-1.5 py-0.2 bg-neutral-800 text-neutral-300 text-[9px] rounded-xs">v2.0-CLEAN-SLATE</span>
        </div>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="hidden md:flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            ENGINE: ACTIVE (CENTIMETRIC)
          </span>
          <span className="text-neutral-500">|</span>
          <span className="text-neutral-300">ISO/EN 13402 BASE</span>
        </div>
      </div>

      {/* Main navigation header */}
      <div className="px-4 lg:px-8 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-serif tracking-tight font-bold text-neutral-900">
              Patroner
            </h1>
            <span className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
              Atelier
            </span>
          </div>

          <div className="h-4 w-px bg-neutral-200 hidden sm:block"></div>

          {/* Active project pill */}
          <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-600 bg-neutral-50 px-2.5 py-1 rounded border border-neutral-200">
            <span className="text-neutral-400 font-mono text-[10px]">CURRENT:</span>
            <span className="font-medium text-neutral-800 truncate max-w-[200px]">{activeDesignName}</span>
            {isApproved ? (
              <Badge variant="success" size="sm">Approved</Badge>
            ) : (
              <Badge variant="warning" size="sm">Draft Spec</Badge>
            )}
            {isDraftValid && (
              <Badge variant="dark" size="sm">CAD Ready</Badge>
            )}
          </div>
        </div>

        {/* Tab navigation */}
        <nav className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 shrink-0" aria-label="Main Navigation">
          <button
            onClick={() => onTabChange('studio')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'studio'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            1. Studio
          </button>

          <button
            onClick={() => onTabChange('specification')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'specification'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            2. Tech Spec
            {isApproved && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>}
          </button>

          <button
            onClick={() => onTabChange('measurements')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'measurements'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            3. Sizing &amp; Ease
          </button>

          <button
            onClick={() => onTabChange('pattern-cad')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'pattern-cad'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            4. Pattern CAD
            {isDraftValid && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>}
          </button>

          <button
            onClick={() => onTabChange('production')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'production'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            5. Production
          </button>
        </nav>
      </div>
    </header>
  );
};
