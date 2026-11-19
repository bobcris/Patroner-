/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button';

interface WorkspaceErrorBoundaryProps {
  children: React.ReactNode;
  onResetWorkspace?: () => void;
}

interface WorkspaceErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class WorkspaceErrorBoundary extends React.Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: ''
    };
  }

  static getDerivedStateFromError(error: unknown): WorkspaceErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }

  private handleRecover = () => {
    this.setState({ hasError: false, errorMessage: '' });
    if (this.props.onResetWorkspace) {
      this.props.onResetWorkspace();
    }
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="max-w-3xl mx-auto px-4 py-16">
          <div className="bg-white border border-rose-300 rounded-sm p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-rose-800 font-mono text-xs uppercase font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Workspace Runtime Recovery</span>
            </div>
            <h2 className="text-xl font-serif font-bold text-neutral-900">
              An unexpected error interrupted this workspace module
            </h2>
            <p className="text-xs font-mono text-neutral-700 bg-rose-50 border border-rose-200 rounded p-3 break-words">
              {this.state.errorMessage || 'Unknown workspace error'}
            </p>
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={this.handleRecover}
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                className="font-mono text-xs uppercase"
              >
                Restore Valid Atelier Preset &amp; Studio
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
