/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BodyMeasurements, DesignSpecification, StandardSize } from '../../types';
import {
  STANDARD_SIZING_SYSTEM,
  calculateGarmentDimensions,
  validateBodyMeasurements
} from '../../engine/measurements/standards';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Compass, CheckCircle2, AlertTriangle, ArrowRight, Scissors } from 'lucide-react';

interface MeasurementWorkspaceProps {
  currentMeasurements: BodyMeasurements;
  activeSize: StandardSize | 'custom';
  currentSpec: DesignSpecification;
  onUpdateMeasurements: (m: BodyMeasurements, sizeLabel: StandardSize | 'custom') => void;
  onNavigateToCAD: () => void;
}

export const MeasurementWorkspace: React.FC<MeasurementWorkspaceProps> = ({
  currentMeasurements,
  activeSize,
  currentSpec,
  onUpdateMeasurements,
  onNavigateToCAD
}) => {
  const [selectedSize, setSelectedSize] = useState<StandardSize | 'custom'>(activeSize);
  const [measurements, setMeasurements] = useState<BodyMeasurements>(currentMeasurements);

  const validation = validateBodyMeasurements(measurements);
  const garmentDims = calculateGarmentDimensions(measurements, currentSpec.easeProfile, currentSpec.fabric);

  const handleSelectStandardSize = (size: StandardSize) => {
    setSelectedSize(size);
    const standardValues = STANDARD_SIZING_SYSTEM.sizes[size];
    setMeasurements(standardValues);
    onUpdateMeasurements(standardValues, size);
  };

  const handleCustomFieldChange = (field: keyof BodyMeasurements, val: number) => {
    const updated: BodyMeasurements = {
      ...measurements,
      [field]: val
    };
    setSelectedSize('custom');
    setMeasurements(updated);
    onUpdateMeasurements(updated, 'custom');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-200 pb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-widest text-neutral-500 font-mono">Module 03</span>
            <span className="text-neutral-300">/</span>
            <Badge variant="dark" size="sm">Anthropometric Engine</Badge>
            <span className="text-neutral-400 font-mono text-xs">INTERNAL UNIT: CENTIMETRES (CM)</span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-serif font-bold text-neutral-900 tracking-tight">
            Measurement &amp; Sizing Engine
          </h2>
          <p className="text-sm text-neutral-600 mt-1 max-w-2xl">
            Strict separation between anatomical body measurements, mechanical ease, and finished garment pattern dimensions.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={onNavigateToCAD}
          icon={<Scissors className="w-4 h-4" />}
          className="font-mono text-xs uppercase tracking-wider"
        >
          Draft in Pattern CAD <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      </div>

      {/* Sizing Standard Citation Banner */}
      <div className="bg-stone-50 border border-stone-200 rounded-sm p-4 text-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-mono">
            <span className="font-semibold text-neutral-900">REFERENCE STANDARD:</span>
            <span className="text-neutral-700">{STANDARD_SIZING_SYSTEM.system}</span>
            <Badge variant="neutral" size="sm">ISO 13402</Badge>
          </div>
          <p className="text-neutral-600 text-[11px]">
            {STANDARD_SIZING_SYSTEM.description}
          </p>
        </div>
        <div className="text-[11px] font-mono text-neutral-500">
          MODE: {selectedSize === 'custom' ? 'CUSTOM BESPOKE PROFILE' : `STANDARD SIZE ${selectedSize}`}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Size Selector & Body Measurement Inputs */}
        <div className="lg:col-span-7 space-y-6">
          {/* Standard Size Selector Pills */}
          <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-neutral-900">
                1. Standard Sizing Chart (XS – XXL)
              </h3>
              <span className="text-[10px] text-neutral-400 font-mono">EU BASE</span>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {(['XS', 'S', 'M', 'L', 'XL', 'XXL'] as StandardSize[]).map(size => {
                const isSelected = selectedSize === size;
                const sizeData = STANDARD_SIZING_SYSTEM.sizes[size];
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => handleSelectStandardSize(size)}
                    className={`p-3 text-center rounded border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-neutral-900 bg-neutral-900 text-white shadow-xs'
                        : 'border-neutral-200 bg-neutral-50/50 hover:bg-neutral-100 text-neutral-800'
                    }`}
                  >
                    <span className="text-sm font-bold font-mono block">{size}</span>
                    <span className="text-[10px] font-mono block opacity-80 mt-1">W: {sizeData.waist}cm</span>
                    <span className="text-[10px] font-mono block opacity-80">H: {sizeData.lowHip}cm</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Anatomical Measurement Inputs */}
          <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-neutral-900 flex items-center gap-2">
                <Compass className="w-4 h-4 text-neutral-500" />
                2. Anatomical Body Measurements (cm)
              </h3>
              <span className="text-[11px] font-mono text-neutral-500">
                {selectedSize === 'custom' ? 'CUSTOM INPUTS' : 'DERIVED FROM SIZING TABLE'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label htmlFor="input-waist" className="block text-neutral-700 font-medium mb-1">
                  Natural Waist Girth
                </label>
                <div className="relative">
                  <input
                    id="input-waist"
                    type="number"
                    step="0.5"
                    min="45"
                    max="150"
                    value={measurements.waist}
                    onChange={e => handleCustomFieldChange('waist', parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 pr-10 border border-neutral-300 rounded font-mono font-semibold text-neutral-900 bg-white"
                  />
                  <span className="absolute right-3 top-2.5 text-neutral-400 font-mono text-xs">cm</span>
                </div>
                <span className="text-[10px] text-neutral-400 block mt-1">Narrowest point of torso</span>
              </div>

              <div>
                <label htmlFor="input-lowhip" className="block text-neutral-700 font-medium mb-1">
                  Low Hip Girth (Fullest)
                </label>
                <div className="relative">
                  <input
                    id="input-lowhip"
                    type="number"
                    step="0.5"
                    min="60"
                    max="180"
                    value={measurements.lowHip}
                    onChange={e => handleCustomFieldChange('lowHip', parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 pr-10 border border-neutral-300 rounded font-mono font-semibold text-neutral-900 bg-white"
                  />
                  <span className="absolute right-3 top-2.5 text-neutral-400 font-mono text-xs">cm</span>
                </div>
                <span className="text-[10px] text-neutral-400 block mt-1">Fullest horizontal line over buttocks</span>
              </div>

              <div>
                <label htmlFor="input-wth" className="block text-neutral-700 font-medium mb-1">
                  Waist to Hip Depth
                </label>
                <div className="relative">
                  <input
                    id="input-wth"
                    type="number"
                    step="0.5"
                    min="14"
                    max="30"
                    value={measurements.waistToHip}
                    onChange={e => handleCustomFieldChange('waistToHip', parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 pr-10 border border-neutral-300 rounded font-mono font-semibold text-neutral-900 bg-white"
                  />
                  <span className="absolute right-3 top-2.5 text-neutral-400 font-mono text-xs">cm</span>
                </div>
                <span className="text-[10px] text-neutral-400 block mt-1">Vertical drop from waist to low hip</span>
              </div>

              <div>
                <label htmlFor="input-length" className="block text-neutral-700 font-medium mb-1">
                  Garment Length (Waist to Hem)
                </label>
                <div className="relative">
                  <input
                    id="input-length"
                    type="number"
                    step="1"
                    min="30"
                    max="120"
                    value={measurements.skirtLength}
                    onChange={e => handleCustomFieldChange('skirtLength', parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 pr-10 border border-neutral-300 rounded font-mono font-semibold text-neutral-900 bg-white"
                  />
                  <span className="absolute right-3 top-2.5 text-neutral-400 font-mono text-xs">cm</span>
                </div>
                <span className="text-[10px] text-neutral-400 block mt-1">Target design length</span>
              </div>
            </div>

            {/* Validation Feedback */}
            {!validation.isValid && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  Measurement Bounds Error
                </div>
                {validation.errors.map((err, i) => (
                  <p key={i} className="text-[11px]">• {err}</p>
                ))}
              </div>
            )}

            {validation.warnings.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Anthropometric Warning
                </div>
                {validation.warnings.map((warn, i) => (
                  <p key={i} className="text-[11px]">• {warn}</p>
                ))}
              </div>
            )}

            {validation.isValid && validation.warnings.length === 0 && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Measurements verified within valid anthropometric ranges.</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Three-Way Dimension Breakdown */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-6">
            <div className="border-b border-neutral-100 pb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 block">
                MATHEMATICAL RECONCILIATION
              </span>
              <h3 className="text-sm font-semibold uppercase tracking-wider font-mono text-neutral-900 mt-0.5">
                Body vs. Garment vs. Pattern Dimensions
              </h3>
            </div>

            {/* Reconciliation Cards */}
            <div className="space-y-3 font-mono text-xs">
              {/* Waist Tier */}
              <div className="p-3 bg-neutral-50 rounded border border-neutral-200 space-y-2">
                <div className="flex items-center justify-between text-neutral-800 font-semibold border-b border-neutral-200 pb-1.5">
                  <span>WAISTLINE TIER</span>
                  <Badge variant="neutral" size="sm">EASE: {currentSpec.easeProfile.toUpperCase()}</Badge>
                </div>

                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between text-neutral-600">
                    <span>1. Body Dimension (Naked):</span>
                    <span className="font-semibold text-neutral-900">{measurements.waist.toFixed(1)} cm</span>
                  </div>
                  <div className="flex justify-between text-neutral-600">
                    <span>2. Applied Mechanical Ease:</span>
                    <span className="font-semibold text-emerald-700">+{garmentDims.appliedWaistEaseCm.toFixed(1)} cm</span>
                  </div>
                  <div className="flex justify-between text-neutral-900 font-bold border-t border-dashed border-neutral-300 pt-1">
                    <span>3. Finished Garment Circumference:</span>
                    <span className="text-neutral-900">{garmentDims.garmentWaistCm.toFixed(1)} cm</span>
                  </div>
                  <div className="flex justify-between text-neutral-500 text-[10px]">
                    <span>4. Pattern Quarter Block Cut (before dart):</span>
                    <span>{(garmentDims.garmentWaistCm / 4).toFixed(2)} cm</span>
                  </div>
                </div>
              </div>

              {/* Low Hip Tier */}
              <div className="p-3 bg-neutral-50 rounded border border-neutral-200 space-y-2">
                <div className="flex items-center justify-between text-neutral-800 font-semibold border-b border-neutral-200 pb-1.5">
                  <span>LOW HIP TIER</span>
                  <Badge variant="neutral" size="sm">FULL CONTOUR</Badge>
                </div>

                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between text-neutral-600">
                    <span>1. Body Dimension (Naked):</span>
                    <span className="font-semibold text-neutral-900">{measurements.lowHip.toFixed(1)} cm</span>
                  </div>
                  <div className="flex justify-between text-neutral-600">
                    <span>2. Applied Mechanical Ease:</span>
                    <span className="font-semibold text-emerald-700">+{garmentDims.appliedHipEaseCm.toFixed(1)} cm</span>
                  </div>
                  <div className="flex justify-between text-neutral-900 font-bold border-t border-dashed border-neutral-300 pt-1">
                    <span>3. Finished Garment Circumference:</span>
                    <span className="text-neutral-900">{garmentDims.garmentHipCm.toFixed(1)} cm</span>
                  </div>
                  <div className="flex justify-between text-neutral-500 text-[10px]">
                    <span>4. Pattern Quarter Block Cut:</span>
                    <span>{(garmentDims.garmentHipCm / 4).toFixed(2)} cm</span>
                  </div>
                </div>
              </div>

              {/* Length Tier */}
              <div className="p-3 bg-neutral-50 rounded border border-neutral-200 space-y-2">
                <div className="flex items-center justify-between text-neutral-800 font-semibold border-b border-neutral-200 pb-1.5">
                  <span>LENGTH &amp; ALLOWANCES</span>
                  <Badge variant="neutral" size="sm">CUT SPECS</Badge>
                </div>

                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between text-neutral-600">
                    <span>Finished Skirt Length:</span>
                    <span className="font-semibold text-neutral-900">{garmentDims.totalLengthCm} cm</span>
                  </div>
                  <div className="flex justify-between text-neutral-600">
                    <span>Hem Allowance (Cut Offset):</span>
                    <span className="font-semibold text-neutral-800">+3.0 cm</span>
                  </div>
                  <div className="flex justify-between text-neutral-600">
                    <span>Waist Seam Allowance:</span>
                    <span className="font-semibold text-neutral-800">+1.0 cm</span>
                  </div>
                  <div className="flex justify-between text-neutral-600">
                    <span>Side Seam Allowance:</span>
                    <span className="font-semibold text-neutral-800">+1.5 cm</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action to CAD */}
            <Button
              variant="primary"
              size="lg"
              onClick={onNavigateToCAD}
              className="w-full font-mono text-xs uppercase tracking-wider"
              icon={<Scissors className="w-4 h-4" />}
            >
              Open Pattern CAD Canvas
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
