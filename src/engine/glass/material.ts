import type { RGB } from '@/math/types';

/** Physically motivated liquid-glass material parameters. */
export interface GlassMaterial {
  /** Relative IOR, typical UI glass ~1.4–1.6 */
  ior: number;
  /** Glass body depth in logical px (drives refraction & light path length) */
  thickness: number;
  /** Dome fullness of the curved surface: <1 bulbous, >1 flat-topped */
  curvature: number;
  /** Microfacet roughness [0,1] */
  roughness: number;
  /** Body tint (linear-ish RGB 0–1) */
  tint: RGB;
  /** Transmission strength [0,1] */
  transmission: number;
  /** Per-channel IOR delta → chromatic dispersion */
  dispersion: number;
  /** Specular / reflection contribution */
  specular: number;
  /** Edge lens boost from surface gradient */
  edgeBoost: number;
  /** Virtual distance from glass mid-plane to the background plane (logical px) */
  sceneDistance: number;
  /** Milky in-scatter amount [0,1] (frosted body look) */
  milkiness: number;
  /** Liquid normal/thickness perturbation */
  liquidity: number;
  liquidSpeed: number;
  /** Soft absorption density for Beer-Lambert */
  absorption: number;
}

export interface RoundedRectShape {
  kind: 'rounded-rect';
  cornerRadius: number;
  /** Bevel width controlling edge thickness falloff */
  bevel: number;
}

/** Signature looks; `poster` doubles as the engine default. */
export interface GlassPreset {
  id: 'poster' | 'clear' | 'frosted';
  label: string;
  material: GlassMaterial;
}

export const GLASS_PRESETS: GlassPreset[] = [
  {
    id: 'clear',
    label: '清水',
    material: {
      ior: 1.48,
      thickness: 18,
      curvature: 3.0,
      roughness: 0.04,
      tint: { r: 0.985, g: 0.99, b: 1.0 },
      transmission: 1.0,
      dispersion: 0.035,
      specular: 1.05,
      edgeBoost: 1.1,
      sceneDistance: 220,
      milkiness: 0.02,
      liquidity: 0,
      liquidSpeed: 0.2,
      absorption: 0.005,
    },
  },
  {
    id: 'poster',
    label: '海报',
    material: {
      ior: 1.5,
      thickness: 22,
      curvature: 2.6,
      roughness: 0.12,
      tint: { r: 0.965, g: 0.97, b: 0.985 },
      transmission: 0.96,
      dispersion: 0.045,
      specular: 1.0,
      edgeBoost: 1.1,
      sceneDistance: 260,
      milkiness: 0.22,
      liquidity: 0,
      liquidSpeed: 0.25,
      absorption: 0.02,
    },
  },
  {
    id: 'frosted',
    label: '浓磨砂',
    material: {
      ior: 1.46,
      thickness: 22,
      curvature: 2.2,
      roughness: 0.5,
      tint: { r: 0.96, g: 0.965, b: 0.98 },
      transmission: 0.9,
      dispersion: 0.05,
      specular: 0.8,
      edgeBoost: 1.1,
      sceneDistance: 280,
      milkiness: 0.55,
      liquidity: 0,
      liquidSpeed: 0.3,
      absorption: 0.03,
    },
  },
];

export function defaultGlassMaterial(overrides: Partial<GlassMaterial> = {}): GlassMaterial {
  const base = GLASS_PRESETS[0]!.material;
  return {
    ...base,
    ...overrides,
    tint: { ...base.tint, ...overrides.tint },
  };
}

export function defaultWindowShape(cornerRadius = 22): RoundedRectShape {
  return {
    kind: 'rounded-rect',
    cornerRadius,
    // Equal-width bend ring around the pane (SDF distance keeps it uniform
    // on rectangular windows); wide enough for a fold-free refraction ramp.
    bevel: 52,
  };
}

/** Slightly brighter edge for focused windows */
export function focusBoost(mat: GlassMaterial): GlassMaterial {
  return {
    ...mat,
    edgeBoost: mat.edgeBoost * 1.12,
    specular: Math.min(1.4, mat.specular * 1.15),
    liquidity: mat.liquidity * 1.05,
  };
}
