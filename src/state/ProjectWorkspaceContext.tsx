/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BodiceDartStyle,
  BodyMeasurements,
  DesignSpecification,
  EaseProfile,
  GarmentCategory,
  Silhouette,
  SleeveEaseStrategy,
  StandardSize
} from '../types';
import { INITIAL_CONCEPTS } from '../domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from '../engine/measurements/standards';
import {
  AuthoritativeProductionWorkspaceBundle,
  buildAuthoritativeProductionWorkspaceBundle,
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
  executeGuardedBaselineCommit,
  extractRevisionBaselineFromBundle,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementProvenanceEvidence,
  NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS,
  PreviousPackageRevisionInput,
  ProductionWorkspaceBomControls,
  transitionMeasurementProvenance
} from '../engine/production';
import type { WorkspaceTab } from '../components/layout/Header';

export type ExperienceMode = 'creative-studio' | 'professional-workshop';
export type WorkshopTab = Exclude<WorkspaceTab, 'studio'>;

export interface ReferenceImageAsset {
  name: string;
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
}

export const ALLOWED_REFERENCE_IMAGE_MIME_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp'
]);

export const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_CONCEPT_HISTORY_ITEMS = 8;

export interface ReferenceImageValidationResult {
  valid: boolean;
  error?: string;
}

export interface StudioDraftBrief {
  prompt: string;
  category: GarmentCategory;
  silhouette: Silhouette;
  selectedFabricId: string;
  selectedColor: { name: string; hex: string };
  easeProfile: EaseProfile;
  lengthCm: number;
}

/**
 * Formats an oversized file size in MB rounded upward to 2 decimal places so any file
 * strictly larger than 5.0 MB never rounds down to a contradictory "5.00 MB" message (M-B4-02).
 */
export function formatOversizeImageMb(sizeBytes: number): string {
  const exactMb = sizeBytes / (1024 * 1024);
  const roundedUp = Math.ceil(exactMb * 100) / 100;
  return Math.max(roundedUp, 5.01).toFixed(2);
}

/**
 * Pure helper creating a Creative Studio draft brief snapshot from a DesignSpecification (M-B3-02).
 */
export function createStudioDraftBriefFromSpec(spec: DesignSpecification): StudioDraftBrief {
  return {
    prompt: spec.prompt,
    category: spec.garmentCategory,
    silhouette: spec.silhouette,
    selectedFabricId: spec.fabric.id,
    selectedColor: { ...spec.color },
    easeProfile: spec.easeProfile,
    lengthCm: spec.lengthCm
  };
}

/**
 * Pure helper computing drafting option updates when currentSpec changes, avoiding nested setState
 * inside React functional state updaters (M-B3-01).
 */
export function deriveDraftingOptionsForSpecChange(
  prevSpec: DesignSpecification,
  nextSpec: DesignSpecification
): { bodiceDartStyle?: BodiceDartStyle; sleeveEaseStrategy?: SleeveEaseStrategy } {
  const isSwitchingGarment =
    nextSpec.id !== prevSpec.id || nextSpec.garmentCategory !== prevSpec.garmentCategory;

  if (isSwitchingGarment) {
    return {
      bodiceDartStyle: nextSpec.dartStyle ?? 'waist',
      sleeveEaseStrategy: nextSpec.sleeveEaseStrategy ?? 'classic'
    };
  }

  const delta: { bodiceDartStyle?: BodiceDartStyle; sleeveEaseStrategy?: SleeveEaseStrategy } = {};
  if (nextSpec.dartStyle !== prevSpec.dartStyle) {
    delta.bodiceDartStyle = nextSpec.dartStyle ?? 'waist';
  }
  if (nextSpec.sleeveEaseStrategy !== prevSpec.sleeveEaseStrategy) {
    delta.sleeveEaseStrategy = nextSpec.sleeveEaseStrategy ?? 'classic';
  }
  return delta;
}

/**
 * Pure validator for uploaded reference moodboard/photograph files.
 */
export function validateReferenceImageFile(file: {
  name: string;
  type: string;
  size: number;
}): ReferenceImageValidationResult {
  if (!ALLOWED_REFERENCE_IMAGE_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      error: `Unsupported image format "${file.type || 'unknown'}". Please upload a PNG, JPG, or WEBP image.`
    };
  }
  if (file.size <= 0) {
    return {
      valid: false,
      error: `File "${file.name}" is empty. Please choose a valid image file.`
    };
  }
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    const sizeMb = formatOversizeImageMb(file.size);
    return {
      valid: false,
      error: `Image "${file.name}" is ${sizeMb} MB, which exceeds the 5.0 MB limit.`
    };
  }
  return { valid: true };
}

/**
 * Pure helper to maintain lightweight concept history snapshots without duplicating active state.
 */
export function appendConceptHistory(
  history: readonly DesignSpecification[],
  nextSpec: DesignSpecification,
  maxItems: number = MAX_CONCEPT_HISTORY_ITEMS
): DesignSpecification[] {
  const key = `${nextSpec.id}::v${nextSpec.version}`;
  const filtered = history.filter(item => `${item.id}::v${item.version}` !== key);
  return [nextSpec, ...filtered].slice(0, maxItems);
}

/**
 * Pure helper mapping primary experience mode switches to the corresponding workspace tab.
 */
export function resolveTabForExperienceMode(
  mode: ExperienceMode,
  lastWorkshopTab: WorkshopTab
): WorkspaceTab {
  return mode === 'creative-studio' ? 'studio' : lastWorkshopTab;
}

export interface ProjectWorkspaceContextValue {
  // Dual-experience navigation state
  experienceMode: ExperienceMode;
  activeTab: WorkspaceTab;
  lastWorkshopTab: WorkshopTab;
  switchExperienceMode: (mode: ExperienceMode) => void;
  navigateToTab: (tab: WorkspaceTab) => void;

  // Authoritative project specification & lightweight concept history
  currentSpec: DesignSpecification;
  conceptHistory: readonly DesignSpecification[];
  updateSpec: (nextSpec: DesignSpecification) => void;

  // Shared reference image & unsaved Creative Studio draft brief (persisted across Creative Studio <-> Professional Workshop)
  referenceImage: ReferenceImageAsset | null;
  setReferenceImage: (asset: ReferenceImageAsset | null) => void;
  studioDraftBrief: StudioDraftBrief;
  updateStudioDraftBrief: (patch: Partial<StudioDraftBrief>) => void;

  // Authoritative measurements & provenance state
  activeSize: StandardSize | 'custom';
  measurements: BodyMeasurements;
  measurementProvenance: MeasurementOrigin;
  measurementApprovalState: MeasurementApprovalStatus;
  measurementProvenanceEvidence: MeasurementProvenanceEvidence | undefined;
  measurementRevisionCount: number;
  measurementRevisionId: string;
  updateMeasurements: (
    m: BodyMeasurements,
    sizeLabel: StandardSize | 'custom',
    provenance?: MeasurementOrigin
  ) => void;
  updateMeasurementProvenance: (
    nextOrigin: MeasurementOrigin,
    evidence?: MeasurementProvenanceEvidence
  ) => void;
  updateMeasurementApproval: (nextState: MeasurementApprovalStatus) => void;

  // Shared BOM & drafting governance options
  bomControls: ProductionWorkspaceBomControls;
  setBomControls: (next: ProductionWorkspaceBomControls) => void;
  bodiceDartStyle: BodiceDartStyle;
  setBodiceDartStyle: (next: BodiceDartStyle) => void;
  sleeveEaseStrategy: SleeveEaseStrategy;
  setSleeveEaseStrategy: (next: SleeveEaseStrategy) => void;
  strictUncertaintyGate: boolean;
  setStrictUncertaintyGate: (next: boolean) => void;
  requireApprovedGovernance: boolean;
  setRequireApprovedGovernance: (next: boolean) => void;

  // Single memoized authoritative production workspace bundle
  workspaceBundle: AuthoritativeProductionWorkspaceBundle;
  isPackageStale: boolean;
  isSynchronized: boolean;
  specificationRevisionId: string;

  // Guarded baseline & recovery actions
  commitProductionBaseline: () => void;
  syncWorkingDraftSnapshot: () => void;
  resetWorkspace: () => void;
}

const ProjectWorkspaceContext = createContext<ProjectWorkspaceContextValue | null>(null);

export interface ProjectWorkspaceProviderProps {
  children: React.ReactNode;
  initialSpec?: DesignSpecification;
  initialTab?: WorkspaceTab;
}

export const ProjectWorkspaceProvider: React.FC<ProjectWorkspaceProviderProps> = ({
  children,
  initialSpec = INITIAL_CONCEPTS[0],
  initialTab = 'studio'
}) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [lastWorkshopTab, setLastWorkshopTab] = useState<WorkshopTab>(
    initialTab === 'studio' ? 'specification' : initialTab
  );
  const [currentSpec, setCurrentSpec] = useState<DesignSpecification>(initialSpec);
  const [conceptHistory, setConceptHistory] = useState<DesignSpecification[]>([initialSpec]);
  const [referenceImage, setReferenceImage] = useState<ReferenceImageAsset | null>(null);
  const [studioDraftBrief, setStudioDraftBrief] = useState<StudioDraftBrief>(() =>
    createStudioDraftBriefFromSpec(initialSpec)
  );

  const [activeSize, setActiveSize] = useState<StandardSize | 'custom'>('M');
  const [measurements, setMeasurements] = useState<BodyMeasurements>({
    ...STANDARD_SIZING_SYSTEM.sizes.M,
    skirtLength: initialSpec.lengthCm
  });
  const [measurementProvenance, setMeasurementProvenance] = useState<MeasurementOrigin>('standard-chart');
  const [measurementApprovalState, setMeasurementApprovalState] = useState<MeasurementApprovalStatus>('unverified');
  const [measurementProvenanceEvidence, setMeasurementProvenanceEvidence] = useState<
    MeasurementProvenanceEvidence | undefined
  >(undefined);
  const [measurementRevisionCount, setMeasurementRevisionCount] = useState<number>(1);

  // Single authoritative state owner for shared BOM controls & governance options (P1-2A)
  const [bomControls, setBomControls] = useState<ProductionWorkspaceBomControls>(
    DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS
  );
  const [bodiceDartStyle, setBodiceDartStyle] = useState<BodiceDartStyle>(
    initialSpec.dartStyle ?? 'waist'
  );
  const [sleeveEaseStrategy, setSleeveEaseStrategy] = useState<SleeveEaseStrategy>(
    initialSpec.sleeveEaseStrategy ?? 'classic'
  );
  const [strictUncertaintyGate, setStrictUncertaintyGate] = useState<boolean>(true);
  const [requireApprovedGovernance, setRequireApprovedGovernance] = useState<boolean>(false);

  // Committed package baselines per garment ID for genuine upstream staleness propagation (P1-2)
  const [committedBaselinesByGarment, setCommittedBaselinesByGarment] = useState<
    Record<string, PreviousPackageRevisionInput>
  >({});

  const experienceMode: ExperienceMode =
    activeTab === 'studio' ? 'creative-studio' : 'professional-workshop';

  const navigateToTab = useCallback((tab: WorkspaceTab) => {
    setActiveTab(tab);
    if (tab !== 'studio') {
      setLastWorkshopTab(tab);
    }
  }, []);

  const switchExperienceMode = useCallback(
    (mode: ExperienceMode) => {
      const targetTab = resolveTabForExperienceMode(mode, lastWorkshopTab);
      setActiveTab(targetTab);
    },
    [lastWorkshopTab]
  );

  const currentSpecRef = useRef<DesignSpecification>(currentSpec);
  currentSpecRef.current = currentSpec;

  const measurementProvenanceRef = useRef<MeasurementOrigin>(measurementProvenance);
  measurementProvenanceRef.current = measurementProvenance;

  const updateStudioDraftBrief = useCallback((patch: Partial<StudioDraftBrief>) => {
    setStudioDraftBrief(prev => ({ ...prev, ...patch }));
  }, []);

  const updateSpec = useCallback((nextSpec: DesignSpecification) => {
    const prevSpec = currentSpecRef.current;
    currentSpecRef.current = nextSpec;

    const switchedGarment = prevSpec.id !== nextSpec.id;
    setCurrentSpec(nextSpec);
    if (switchedGarment) {
      setBodiceDartStyle(nextSpec.dartStyle ?? 'waist');
      setSleeveEaseStrategy(nextSpec.sleeveEaseStrategy ?? 'classic');
    } else {
      const draftingDelta = deriveDraftingOptionsForSpecChange(prevSpec, nextSpec);
      if (draftingDelta.bodiceDartStyle !== undefined) {
        setBodiceDartStyle(draftingDelta.bodiceDartStyle);
      }
      if (draftingDelta.sleeveEaseStrategy !== undefined) {
        setSleeveEaseStrategy(draftingDelta.sleeveEaseStrategy);
      }
    }
    setStudioDraftBrief(createStudioDraftBriefFromSpec(nextSpec));
    setConceptHistory(prev => appendConceptHistory(prev, nextSpec));
  }, []);

  const committedPreviousRevision = committedBaselinesByGarment[currentSpec.id];

  // Single authoritative memoized production workspace bundle consumed across shell, CAD, and Production
  const workspaceBundle = useMemo(
    () =>
      buildAuthoritativeProductionWorkspaceBundle({
        projectId: 'project-patroner-default',
        tenantId: 'tenant-studio-local',
        designSpec: currentSpec,
        measurements,
        activeSize: String(activeSize),
        bomControls,
        governance: {
          bodiceDartStyle,
          sleeveEaseStrategy,
          strictUncertaintyGate,
          requireApprovedGovernance,
          measurementProvenance,
          measurementApprovalState,
          measurementProvenanceEvidence
        },
        previousPackageRevision: committedPreviousRevision
      }),
    [
      currentSpec,
      measurements,
      activeSize,
      bomControls,
      bodiceDartStyle,
      sleeveEaseStrategy,
      strictUncertaintyGate,
      requireApprovedGovernance,
      measurementProvenance,
      measurementApprovalState,
      measurementProvenanceEvidence,
      committedPreviousRevision
    ]
  );

  // Capture initial session baseline for a newly visited garment (never overwrites once set until guarded commit/sync)
  useEffect(() => {
    if (committedBaselinesByGarment[currentSpec.id]) return;
    const baseline = extractRevisionBaselineFromBundle(workspaceBundle);
    if (!baseline) return;
    setCommittedBaselinesByGarment(prev => {
      if (prev[currentSpec.id]) return prev;
      return {
        ...prev,
        [currentSpec.id]: baseline
      };
    });
  }, [currentSpec.id, committedBaselinesByGarment, workspaceBundle]);

  // N-04: Guarded production baseline commit — strictly refuses failing or unapproved packages
  const commitProductionBaseline = useCallback(() => {
    executeGuardedBaselineCommit({
      workspaceBundle,
      mode: 'production-baseline',
      onCommit: baseline => {
        setCommittedBaselinesByGarment(prev => ({
          ...prev,
          [currentSpec.id]: baseline
        }));
      }
    });
  }, [workspaceBundle, currentSpec.id]);

  // N-04: Guarded working-draft snapshot sync — strictly refuses any non-staleness validation failures
  const syncWorkingDraftSnapshot = useCallback(() => {
    executeGuardedBaselineCommit({
      workspaceBundle,
      mode: 'working-draft-diagnostic',
      onCommit: baseline => {
        setCommittedBaselinesByGarment(prev => ({
          ...prev,
          [currentSpec.id]: baseline
        }));
      }
    });
  }, [workspaceBundle, currentSpec.id]);

  const updateMeasurements = useCallback(
    (m: BodyMeasurements, sizeLabel: StandardSize | 'custom', provenance?: MeasurementOrigin) => {
      setMeasurements(m);
      setActiveSize(sizeLabel);
      const nextProvenance = provenance ?? (sizeLabel === 'custom' ? 'user-entered' : 'standard-chart');
      measurementProvenanceRef.current = nextProvenance;
      setMeasurementProvenance(nextProvenance);
      if (nextProvenance === 'standard-chart') {
        setMeasurementProvenanceEvidence(undefined);
      }
      // Changing any measurement invalidates prior measurement approval and requires explicit re-approval
      setMeasurementApprovalState('unverified');
      setMeasurementRevisionCount(prev => prev + 1);
    },
    []
  );

  const updateMeasurementProvenance = useCallback(
    (nextOrigin: MeasurementOrigin, evidence?: MeasurementProvenanceEvidence) => {
      const prevOrigin = measurementProvenanceRef.current;
      const transition = transitionMeasurementProvenance(prevOrigin, nextOrigin, evidence);
      if (!transition.isValid) {
        return;
      }
      measurementProvenanceRef.current = transition.nextOrigin;
      setMeasurementProvenance(transition.nextOrigin);
      setMeasurementProvenanceEvidence(transition.evidence);
      if (NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS.has(transition.nextOrigin)) {
        setMeasurementApprovalState('unverified');
      }
      setMeasurementRevisionCount(prev => prev + 1);
    },
    []
  );

  const updateMeasurementApproval = useCallback(
    (nextState: MeasurementApprovalStatus) => {
      if (nextState === 'approved' && NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS.has(measurementProvenance)) {
        return;
      }
      setMeasurementApprovalState(nextState);
    },
    [measurementProvenance]
  );

  const resetWorkspace = useCallback(() => {
    updateSpec(INITIAL_CONCEPTS[0]);
    setActiveTab('studio');
    setLastWorkshopTab('specification');
  }, [updateSpec]);

  const isPackageStale = workspaceBundle.upstreamStaleness.isStaleAgainstPrevious;
  const isSynchronized = workspaceBundle.pipelineReport.isPipelineSynchronized && !isPackageStale;
  const specificationRevisionId =
    currentSpec.specificationRevisionId ?? `spec-${currentSpec.id}-v${currentSpec.version}`;
  const measurementRevisionId = `meas-rev-${measurementRevisionCount}`;

  const value = useMemo<ProjectWorkspaceContextValue>(
    () => ({
      experienceMode,
      activeTab,
      lastWorkshopTab,
      switchExperienceMode,
      navigateToTab,
      currentSpec,
      conceptHistory,
      updateSpec,
      referenceImage,
      setReferenceImage,
      studioDraftBrief,
      updateStudioDraftBrief,
      activeSize,
      measurements,
      measurementProvenance,
      measurementApprovalState,
      measurementProvenanceEvidence,
      measurementRevisionCount,
      measurementRevisionId,
      updateMeasurements,
      updateMeasurementProvenance,
      updateMeasurementApproval,
      bomControls,
      setBomControls,
      bodiceDartStyle,
      setBodiceDartStyle,
      sleeveEaseStrategy,
      setSleeveEaseStrategy,
      strictUncertaintyGate,
      setStrictUncertaintyGate,
      requireApprovedGovernance,
      setRequireApprovedGovernance,
      workspaceBundle,
      isPackageStale,
      isSynchronized,
      specificationRevisionId,
      commitProductionBaseline,
      syncWorkingDraftSnapshot,
      resetWorkspace
    }),
    [
      experienceMode,
      activeTab,
      lastWorkshopTab,
      switchExperienceMode,
      navigateToTab,
      currentSpec,
      conceptHistory,
      updateSpec,
      referenceImage,
      studioDraftBrief,
      updateStudioDraftBrief,
      activeSize,
      measurements,
      measurementProvenance,
      measurementApprovalState,
      measurementProvenanceEvidence,
      measurementRevisionCount,
      measurementRevisionId,
      updateMeasurements,
      updateMeasurementProvenance,
      updateMeasurementApproval,
      bomControls,
      bodiceDartStyle,
      sleeveEaseStrategy,
      strictUncertaintyGate,
      requireApprovedGovernance,
      workspaceBundle,
      isPackageStale,
      isSynchronized,
      specificationRevisionId,
      commitProductionBaseline,
      syncWorkingDraftSnapshot,
      resetWorkspace
    ]
  );

  return (
    <ProjectWorkspaceContext.Provider value={value}>
      {children}
    </ProjectWorkspaceContext.Provider>
  );
};

export function useProjectWorkspace(): ProjectWorkspaceContextValue {
  const ctx = useContext(ProjectWorkspaceContext);
  if (!ctx) {
    throw new Error('useProjectWorkspace must be used inside a ProjectWorkspaceProvider.');
  }
  return ctx;
}
