/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { DesignSpecification, EaseProfile, FabricProperty, GarmentCategory, Silhouette } from '../../types';
import { PRESET_FABRICS } from '../../domain/design/preset-fabrics';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { generateGarmentConcept } from '../../services/ai/fashion-service';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Sparkles, Upload, ArrowRight, CheckCircle2, Sliders, Info, Scissors } from 'lucide-react';

interface FashionStudioProps {
  currentSpec: DesignSpecification;
  onUpdateSpec: (spec: DesignSpecification) => void;
  onNavigateToSpec: () => void;
}

const COLOR_SWATCHES = [
  { name: 'Chalk Oatmeal', hex: '#E8E3D9' },
  { name: 'Midnight Ink', hex: '#1C212D' },
  { name: 'Charcoal Wool', hex: '#2B2B2E' },
  { name: 'Raw Ecru', hex: '#F4F0E8' },
  { name: 'Cognac Leather', hex: '#8B4513' },
  { name: 'Forest Moss', hex: '#2E3B32' },
  { name: 'Burgundy Wine', hex: '#4A1521' }
];

export const FashionStudio: React.FC<FashionStudioProps> = ({
  currentSpec,
  onUpdateSpec,
  onNavigateToSpec
}) => {
  const [prompt, setPrompt] = useState(currentSpec.prompt);
  const [category, setCategory] = useState<GarmentCategory>(currentSpec.garmentCategory);
  const [silhouette, setSilhouette] = useState<Silhouette>(currentSpec.silhouette);
  const [selectedFabricId, setSelectedFabricId] = useState<string>(currentSpec.fabric.id);
  const [selectedColor, setSelectedColor] = useState(currentSpec.color);
  const [easeProfile, setEaseProfile] = useState<EaseProfile>(currentSpec.easeProfile);
  const [lengthCm, setLengthCm] = useState<number>(currentSpec.lengthCm);
  const [referenceImage, setReferenceImage] = useState<{ name: string; url: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);

  const selectedFabric: FabricProperty = PRESET_FABRICS.find(f => f.id === selectedFabricId) || PRESET_FABRICS[0];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setReferenceImage({
          name: file.name,
          url: reader.result as string
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerateConcept = async () => {
    setIsGenerating(true);
    setGenerationNotice(null);

    try {
      const result = await generateGarmentConcept({
        prompt,
        category,
        silhouette,
        fabricId: selectedFabricId,
        colorName: selectedColor.name,
        colorHex: selectedColor.hex,
        easeProfile,
        lengthCm,
        referenceImageName: referenceImage?.name
      });

      onUpdateSpec(result.specification);
      setGenerationNotice(
        result.executionMode === 'live-server-gemini'
          ? 'Concept generated with live server AI multimodal reasoning.'
          : 'Concept generated via Studio Intelligence Engine (Deterministic demonstration mode).'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const loadPresetConcept = (concept: DesignSpecification) => {
    setPrompt(concept.prompt);
    setCategory(concept.garmentCategory);
    setSilhouette(concept.silhouette);
    setSelectedFabricId(concept.fabric.id);
    setSelectedColor(concept.color);
    setEaseProfile(concept.easeProfile);
    setLengthCm(concept.lengthCm);
    onUpdateSpec(concept);
    setGenerationNotice('Curated atelier design concept loaded.');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8">
      {/* Top Banner: atelier title & mode indicator */}
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-neutral-200 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-widest text-neutral-500 font-mono">Module 01</span>
            <span className="text-neutral-300">/</span>
            <Badge variant="dark" size="sm">Design Studio</Badge>
          </div>
          <h2 className="text-2xl lg:text-3xl font-serif font-bold text-neutral-900 tracking-tight">
            AI Fashion Design Studio
          </h2>
          <p className="text-sm text-neutral-600 mt-1 max-w-2xl">
            Synthesize original fashion concepts, define construction specifications, and explore garment silhouettes.
            AI estimates remain strictly separated from deterministic pattern geometry.
          </p>
        </div>

        {/* Quick preset selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-neutral-500 uppercase">Load Preset:</span>
          {INITIAL_CONCEPTS.map(concept => (
            <button
              key={concept.id}
              onClick={() => loadPresetConcept(concept)}
              className="px-2.5 py-1 text-xs border border-neutral-300 rounded bg-white hover:bg-neutral-50 text-neutral-700 cursor-pointer transition-colors"
            >
              {concept.name.split(' ')[1]} {concept.garmentCategory}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Creative Input Controls */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-900 font-mono">
                Creative Design Brief
              </h3>
              <span className="text-[11px] text-neutral-500 font-mono">STEP 01</span>
            </div>

            {/* Prompt input */}
            <div>
              <label htmlFor="design-prompt" className="block text-xs font-medium text-neutral-700 mb-1.5">
                Fashion Prompt / Aesthetic Intent
              </label>
              <textarea
                id="design-prompt"
                rows={3}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="e.g. Minimalist architectural midi skirt in heavy wool crepe with clean vertical darts and concealed center-back zip..."
                className="w-full text-xs p-3 border border-neutral-300 rounded-sm focus:outline-none focus:ring-1 focus:ring-neutral-800 bg-neutral-50/50"
              />
            </div>

            {/* Garment Category */}
            <div>
              <label htmlFor="garment-category" className="block text-xs font-medium text-neutral-700 mb-1.5">
                Garment Category
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['skirt', 'bodice', 'trouser', 'dress'] as GarmentCategory[]).map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`py-2 px-3 text-xs font-medium uppercase tracking-wider rounded-xs border text-left flex items-center justify-between cursor-pointer transition-all ${
                      category === cat
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400'
                    }`}
                  >
                    <span>{cat}</span>
                    {cat === 'skirt' || cat === 'bodice' ? (
                      <span className="text-[9px] font-mono text-emerald-400">CAD READY</span>
                    ) : (
                      <span className="text-[9px] font-mono text-neutral-400">SPECS ONLY</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Silhouette & Length */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="silhouette-select" className="block text-xs font-medium text-neutral-700 mb-1.5">
                  Silhouette Profile
                </label>
                <select
                  id="silhouette-select"
                  value={silhouette}
                  onChange={e => setSilhouette(e.target.value as Silhouette)}
                  className="w-full text-xs p-2.5 border border-neutral-300 rounded-sm bg-white focus:outline-none focus:ring-1 focus:ring-neutral-800"
                >
                  <option value="straight">Straight / Column</option>
                  <option value="a-line">A-Line (+4cm hem flare)</option>
                  <option value="pencil">Pencil (Tapered hem)</option>
                  <option value="flared">Full Flared (+7.5cm)</option>
                </select>
              </div>

              <div>
                <label htmlFor="length-slider" className="block text-xs font-medium text-neutral-700 mb-1.5 flex justify-between">
                  <span>Target Length</span>
                  <span className="font-mono text-neutral-900 font-semibold">{lengthCm} cm</span>
                </label>
                <input
                  id="length-slider"
                  type="range"
                  min="40"
                  max="100"
                  step="2"
                  value={lengthCm}
                  onChange={e => setLengthCm(Number(e.target.value))}
                  className="w-full accent-neutral-900"
                />
                <div className="flex justify-between text-[10px] text-neutral-400 font-mono mt-0.5">
                  <span>Mini (45cm)</span>
                  <span>Midi (65cm)</span>
                  <span>Maxi (90cm)</span>
                </div>
              </div>
            </div>

            {/* Fabric Material Selection */}
            <div>
              <label htmlFor="fabric-select" className="block text-xs font-medium text-neutral-700 mb-1.5">
                Material &amp; Weave
              </label>
              <select
                id="fabric-select"
                value={selectedFabricId}
                onChange={e => setSelectedFabricId(e.target.value)}
                className="w-full text-xs p-2.5 border border-neutral-300 rounded-sm bg-white focus:outline-none focus:ring-1 focus:ring-neutral-800"
              >
                {PRESET_FABRICS.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {f.composition}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-neutral-500 mt-1.5 italic">
                {selectedFabric.drapeDescription}
              </p>
            </div>

            {/* Color Palette */}
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5 flex justify-between">
                <span>Color Palette</span>
                <span className="text-xs font-mono text-neutral-600">{selectedColor.name}</span>
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {COLOR_SWATCHES.map(color => (
                  <button
                    key={color.hex}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    style={{ backgroundColor: color.hex }}
                    title={color.name}
                    className={`w-7 h-7 rounded-full border transition-transform cursor-pointer ${
                      selectedColor.hex === color.hex
                        ? 'ring-2 ring-neutral-900 scale-110 border-white'
                        : 'border-neutral-300 hover:scale-105'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Ease Profile */}
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                Garment Fit &amp; Ease
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['fitted', 'classic', 'relaxed'] as EaseProfile[]).map(ep => (
                  <button
                    key={ep}
                    type="button"
                    onClick={() => setEaseProfile(ep)}
                    className={`py-1.5 text-[11px] uppercase tracking-wider font-mono rounded-xs border text-center cursor-pointer ${
                      easeProfile === ep
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                    }`}
                  >
                    {ep}
                  </button>
                ))}
              </div>
            </div>

            {/* Reference Image Upload Dropzone */}
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                Reference Moodboard / Photograph (Optional)
              </label>
              <div className="border border-dashed border-neutral-300 rounded-sm p-4 text-center hover:border-neutral-400 transition-colors bg-neutral-50/50">
                {referenceImage ? (
                  <div className="flex items-center justify-between text-xs text-neutral-800">
                    <span className="truncate max-w-[200px] font-mono">{referenceImage.name}</span>
                    <button
                      onClick={() => setReferenceImage(null)}
                      className="text-rose-600 hover:underline text-[11px] cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label htmlFor="ref-img-input" className="cursor-pointer block">
                    <Upload className="w-5 h-5 mx-auto text-neutral-400 mb-1.5" />
                    <span className="text-xs text-neutral-600 block font-medium">Click to upload reference image</span>
                    <span className="text-[10px] text-neutral-400 font-mono">PNG, JPG, WEBP for silhouette analysis</span>
                    <input
                      id="ref-img-input"
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* Generation CTA */}
            <Button
              variant="primary"
              size="lg"
              onClick={handleGenerateConcept}
              disabled={isGenerating}
              className="w-full font-mono uppercase tracking-wider text-xs"
              icon={<Sparkles className="w-4 h-4" />}
            >
              {isGenerating ? 'Synthesizing Fashion Concept...' : 'Generate Design Concept'}
            </Button>

            {generationNotice && (
              <div className="p-3 bg-neutral-100 text-neutral-800 text-xs rounded border border-neutral-200 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 text-neutral-600 mt-0.5" />
                <span>{generationNotice}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Concept Presentation & Structured Spec Overview */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-100 pb-4 gap-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="dark" size="sm">ACTIVE CONCEPT</Badge>
                  <span className="text-xs font-mono text-neutral-400">REV. {currentSpec.version}</span>
                  {currentSpec.isApproved ? (
                    <Badge variant="success" size="sm">APPROVED FOR CAD</Badge>
                  ) : (
                    <Badge variant="warning" size="sm">PENDING APPROVAL</Badge>
                  )}
                </div>
                <h3 className="text-xl font-serif font-bold text-neutral-900">
                  {currentSpec.name}
                </h3>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={onNavigateToSpec}
                icon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Inspect Full Tech Spec
              </Button>
            </div>

            {/* Visual Garment Representation */}
            <div className="border border-neutral-200 rounded-sm p-6 bg-gradient-to-b from-stone-50/80 to-stone-100/40 flex flex-col md:flex-row items-center justify-center gap-8 min-h-[300px]">
              {/* Silhouette SVG Illustration */}
              <div className="relative w-48 h-64 shrink-0 flex items-center justify-center">
                <svg
                  viewBox="0 0 200 280"
                  className="w-full h-full drop-shadow-sm"
                  aria-label="Garment Silhouette Sketch"
                >
                  {/* Mannequin guide line */}
                  <line x1="100" y1="10" x2="100" y2="270" stroke="#d4d4d8" strokeWidth="1" strokeDasharray="3 3" />
                  <line x1="30" y1="50" x2="170" y2="50" stroke="#e4e4e7" strokeWidth="1" strokeDasharray="2 2" />
                  <line x1="20" y1="120" x2="180" y2="120" stroke="#e4e4e7" strokeWidth="1" strokeDasharray="2 2" />

                  {/* Garment silhouette rendering */}
                  {currentSpec.silhouette === 'straight' && (
                    <polygon
                      points="65,50 135,50 145,120 145,260 55,260 55,120"
                      fill={currentSpec.color.hex}
                      stroke="#27272a"
                      strokeWidth="2"
                    />
                  )}
                  {currentSpec.silhouette === 'a-line' && (
                    <polygon
                      points="65,50 135,50 150,120 170,260 30,260 50,120"
                      fill={currentSpec.color.hex}
                      stroke="#27272a"
                      strokeWidth="2"
                    />
                  )}
                  {currentSpec.silhouette === 'pencil' && (
                    <polygon
                      points="65,50 135,50 146,120 130,260 70,260 54,120"
                      fill={currentSpec.color.hex}
                      stroke="#27272a"
                      strokeWidth="2"
                    />
                  )}
                  {currentSpec.silhouette === 'flared' && (
                    <polygon
                      points="65,50 135,50 155,120 185,260 15,260 45,120"
                      fill={currentSpec.color.hex}
                      stroke="#27272a"
                      strokeWidth="2"
                    />
                  )}

                  {/* Dart style lines */}
                  <line x1="85" y1="50" x2="85" y2="90" stroke="#18181b" strokeWidth="1.2" />
                  <line x1="115" y1="50" x2="115" y2="90" stroke="#18181b" strokeWidth="1.2" />

                  {/* Waistband line */}
                  <line x1="65" y1="62" x2="135" y2="62" stroke="#18181b" strokeWidth="1" strokeDasharray="2 2" />

                  {/* Hem topstitch */}
                  <line x1="58" y1="248" x2="142" y2="248" stroke="#18181b" strokeWidth="1" strokeDasharray="2 2" />
                </svg>

                {/* Fabric swatch pip */}
                <div
                  className="absolute bottom-2 right-2 w-6 h-6 rounded-full border-2 border-white shadow-xs"
                  style={{ backgroundColor: currentSpec.color.hex }}
                  title={currentSpec.color.name}
                />
              </div>

              {/* Design specifications summary */}
              <div className="space-y-3 text-xs w-full">
                <div className="grid grid-cols-2 gap-2 pb-2 border-b border-neutral-200 font-mono">
                  <div>
                    <span className="text-neutral-400 block text-[10px]">CATEGORY</span>
                    <span className="font-semibold text-neutral-800 uppercase">{currentSpec.garmentCategory}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block text-[10px]">SILHOUETTE</span>
                    <span className="font-semibold text-neutral-800 uppercase">{currentSpec.silhouette}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block text-[10px]">FABRIC</span>
                    <span className="font-semibold text-neutral-800">{currentSpec.fabric.name}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block text-[10px]">LENGTH</span>
                    <span className="font-semibold text-neutral-800">{currentSpec.lengthCm} cm</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block text-[10px]">EASE PROFILE</span>
                    <span className="font-semibold text-neutral-800 uppercase">{currentSpec.easeProfile}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400 block text-[10px]">COLOR</span>
                    <span className="font-semibold text-neutral-800">{currentSpec.color.name}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 block mb-1">
                    Construction Features
                  </span>
                  <ul className="space-y-1.5">
                    {currentSpec.constructionFeatures.map(feat => (
                      <li key={feat.id} className="flex items-start gap-1.5 text-neutral-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-neutral-900 shrink-0 mt-0.5" />
                        <div>
                          <strong className="font-medium text-neutral-900">{feat.name}:</strong>{' '}
                          <span className="text-neutral-600">{feat.description}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* AI Separation Drawer: Explicit AI Estimates & Disclaimer */}
            {currentSpec.aiEstimates && (
              <div className="bg-stone-50 border border-stone-200 rounded-sm p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-neutral-800" />
                    <span className="text-xs font-semibold text-neutral-900 uppercase font-mono tracking-wider">
                      AI Inferred Technical Proposals
                    </span>
                  </div>
                  <span className="text-[10px] font-mono bg-neutral-200 text-neutral-800 px-2 py-0.5 rounded-xs">
                    CONFIDENCE: {currentSpec.aiEstimates.styleConfidenceScore}%
                  </span>
                </div>

                <p className="text-xs text-neutral-700">
                  <strong className="text-neutral-900">Technical Advice:</strong> {currentSpec.aiEstimates.technicalAdvice}
                </p>

                <p className="text-[11px] text-neutral-500 italic pt-1 border-t border-stone-200/80">
                  {currentSpec.aiEstimates.disclaimer}
                </p>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <div className="text-xs text-neutral-500 font-mono">
                {currentSpec.isApproved ? (
                  <span className="text-emerald-700 flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    Specification approved by designer
                  </span>
                ) : (
                  <span className="text-amber-700 flex items-center gap-1.5">
                    <Sliders className="w-4 h-4" />
                    Needs approval to lock pattern geometry
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Button
                  variant="primary"
                  onClick={onNavigateToSpec}
                  className="w-full sm:w-auto font-mono text-xs uppercase tracking-wider"
                  icon={<Scissors className="w-4 h-4" />}
                >
                  Proceed to Tech Spec &amp; Approval
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
