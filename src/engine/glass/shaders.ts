/** Fullscreen triangle vertex shader shared by passes. */
export const FULLSCREEN_VS = /* wgsl */ `
struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var out: VSOut;
  let x = f32(i32(vi & 1u) * 4 - 1);
  let y = f32(i32(vi >> 1u) * 4 - 1);
  out.position = vec4f(x, y, 0.0, 1.0);
  out.uv = vec2f(x * 0.5 + 0.5, 1.0 - (y * 0.5 + 0.5));
  return out;
}
`;

/** Wallpaper: sample the uploaded poster texture with a touch of grain. */
export const WALLPAPER_FS = /* wgsl */ `
struct WallpaperUniforms {
  time: f32,
  aspect: f32,
  _pad0: f32,
  _pad1: f32,
}

@group(0) @binding(0) var wallTex: texture_2d<f32>;
@group(0) @binding(1) var wallSamp: sampler;
@group(0) @binding(2) var<uniform> u: WallpaperUniforms;

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(wallTex, wallSamp, uv, 0.0).rgb;
  let grain = (hash21(uv * vec2f(1920.0, 1080.0) + u.time) - 0.5) * 0.012;
  return vec4f(c + grain, 1.0);
}
`;

export const BLIT_FS = /* wgsl */ `
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSampleLevel(srcTex, srcSamp, uv, 0.0);
}
`;

export const BLUR_FS = /* wgsl */ `
struct BlurUniforms {
  direction: vec2f,
  texel: vec2f,
}

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;
@group(0) @binding(2) var<uniform> u: BlurUniforms;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // 9-tap Gaussian, sigma ~2
  let w0 = 0.227027;
  let w1 = 0.1945946;
  let w2 = 0.1216216;
  let w3 = 0.054054;
  let w4 = 0.016216;
  let dir = u.direction * u.texel;
  var c = textureSampleLevel(srcTex, srcSamp, uv, 0.0) * w0;
  c += textureSampleLevel(srcTex, srcSamp, uv + dir * 1.0, 0.0) * w1;
  c += textureSampleLevel(srcTex, srcSamp, uv - dir * 1.0, 0.0) * w1;
  c += textureSampleLevel(srcTex, srcSamp, uv + dir * 2.0, 0.0) * w2;
  c += textureSampleLevel(srcTex, srcSamp, uv - dir * 2.0, 0.0) * w2;
  c += textureSampleLevel(srcTex, srcSamp, uv + dir * 3.0, 0.0) * w3;
  c += textureSampleLevel(srcTex, srcSamp, uv - dir * 3.0, 0.0) * w3;
  c += textureSampleLevel(srcTex, srcSamp, uv + dir * 4.0, 0.0) * w4;
  c += textureSampleLevel(srcTex, srcSamp, uv - dir * 4.0, 0.0) * w4;
  return c;
}
`;

/**
 * Liquid-glass fragment shader — curved (domed) slab with double refraction.
 *
 * Model: biconvex rounded-rect slab. Top surface z = +h(p), bottom z = -h(p),
 * where h is a dome profile over the rounded-rect SDF plus liquid noise.
 * Per pixel: refract at the top surface, travel to the bottom surface
 * (Newton on the height field), refract back out, then project the exit ray
 * onto the virtual background plane and sample the scene there — per RGB
 * channel with a slightly different IOR, so dispersion appears everywhere
 * the surface bends (not only where the old offset happened to be large).
 *
 * Uniform layout must match packGlassUniforms in compositor.ts (8 x vec4).
 */
export const GLASS_FS = /* wgsl */ `
struct GlassUniforms {
  // rect in logical px: xy = top-left, zw = size
  rect: vec4f,
  // viewport logical size.xy, dpr, time
  viewport: vec4f,
  // ior, thickness (dome depth), roughness, transmission
  params0: vec4f,
  // dispersion (per-channel IOR delta), specular, edgeBoost, absorption
  params1: vec4f,
  // liquidity, liquidSpeed, opacity, scale
  params2: vec4f,
  // tint.rgb, cornerRadius
  tintCorner: vec4f,
  // bevel, titleBarHeight, shadowStrength, curvature
  shapeExtra: vec4f,
  // sceneDistance, milkiness, hover, press
  params3: vec4f,
  // contentPad (logical px of texture padding around the rect), _pad0..2
  params4: vec4f,
}

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var blurTex: texture_2d<f32>;
@group(0) @binding(2) var contentTex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var contentSamp: sampler;
@group(0) @binding(5) var<uniform> u: GlassUniforms;

fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

fn sdRoundBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/** C2 smooth-max: equals max() when |a-b| > k, blends across the tie. */
fn smax(a: f32, b: f32, k: f32) -> f32 {
  let h = smoothstep(0.0, 1.0, 0.5 + 0.5 * (a - b) / k);
  return mix(b, a, h) + k * h * (1.0 - h);
}

/**
 * Pane SDF with its core max() smoothed in place. The hard max() flips its
 * gradient across the four 45° corner bisectors — that flip is the four
 * diagonal creases in everything derived from the distance. smax spreads
 * the flip over ~k px with C2 continuity and deviates from the exact SDF by
 * at most k/4, so the border position and all px band widths are preserved.
 */
fn sdRoundBoxSmooth(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(smax(q.x, q.y, 12.0), 0.0) - r;
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x),
    mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm2(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for (var i = 0; i < 4; i++) {
    v += a * noise2(x);
    x = x * 2.05 + 11.5;
    a *= 0.5;
  }
  return v;
}

/** Static description of the glass body, shared by height evaluations. */
struct SurfaceCtx {
  halfSize: vec2f,
  radius: f32,
  bevel: f32,
  depth: f32,
  minRatio: f32,
  curvature: f32,
  liqAmp: f32,
  phase: f32,
}

/**
 * Top-surface height field z = +h(p) (logical px); the bottom mirrors it.
 * Two-zone profile: a mostly-flat body whose steepness is adjustable
 * (curvature), plus an equal-width fall-off ring at the border — the smooth
 * inside-distance keeps that ring uniform on rectangular windows without
 * the 45° bisector creases the raw SDF would print.
 */
fn surfaceHeight(ctx: SurfaceCtx, p: vec2f) -> f32 {
  let ds = -sdRoundBoxSmooth(p, ctx.halfSize, ctx.radius);
  let inR = max(min(ctx.halfSize.x, ctx.halfSize.y), 1.0);
  let bodyT = saturate(ds / inR); // 1 center → 0 border
  // smoothstep base keeps the derivative finite everywhere (no rim crease at
  // low curvature); curvature > 1 flattens the top into a plateau.
  let dome = pow(1.0 - smoothstep(0.0, 1.0, bodyT), ctx.curvature);
  let edgeT = 1.0 - saturate(ds / max(ctx.bevel, 1.0));
  let edgeFall = pow(edgeT, 1.6);
  let nq = p / max(ctx.halfSize, vec2f(1.0));
  // Uniform-derived branch: liquidity == 0 (every default preset) skips the
  // fbm. surfaceHeight runs 5× per pixel for the lighting gradient — the
  // noise was ~20 of the shader's fbm evaluations even with liquid off.
  var liq = 0.0;
  if (ctx.liqAmp > 0.0) {
    liq = fbm2(nq * 1.7 + vec2f(ctx.phase, -ctx.phase * 0.7)) - 0.5;
  }
  let hBody = ctx.depth * (ctx.minRatio + (1.0 - ctx.minRatio) * dome);
  return hBody * (1.0 - edgeFall) + liq * ctx.liqAmp;
}

fn sampleScene(uv: vec2f, rough: f32) -> vec3f {
  let suv = clamp(uv, vec2f(0.001), vec2f(0.999));
  let sharp = textureSampleLevel(sceneTex, samp, suv, 0.0).rgb;
  // Per-pixel skip: clear-glass body (rough ≈ 0) never reads the blur chain.
  if (rough < 0.004) {
    return sharp;
  }
  let soft = textureSampleLevel(blurTex, samp, suv, 0.0).rgb;
  return mix(sharp, soft, saturate(rough));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let viewport = u.viewport.xy;
  let time = u.viewport.w;

  let ior = clamp(u.params0.x, 1.01, 2.4);
  let depth = max(u.params0.y, 2.0);
  let roughness = saturate(u.params0.z);
  let transmission = saturate(u.params0.w);
  let dispersion = max(u.params1.x, 0.0);
  let specular = max(u.params1.y, 0.0);
  let edgeBoost = max(u.params1.z, 0.0);
  let absorption = max(u.params1.w, 0.0);
  let liquidity = max(u.params2.x, 0.0);
  let liquidSpeed = u.params2.y;
  let opacity = saturate(u.params2.z);
  let scale = max(u.params2.w, 0.01);
  let tint = u.tintCorner.xyz;
  let cornerRadius = u.tintCorner.w;
  let bevel = max(u.shapeExtra.x, 2.0);
  let titleBarHeight = u.shapeExtra.y;
  let shadowStrength = u.shapeExtra.z;
  let curvature = max(u.shapeExtra.w, 0.05);
  let sceneDistance = max(u.params3.x, 1.0);
  let milkiness = saturate(u.params3.y);
  let hover = saturate(u.params3.z);
  let press = saturate(u.params3.w);

  let screen = uv * viewport;
  let rectPos = u.rect.xy;
  let rectSize = max(u.rect.zw, vec2f(1.0));
  let center = rectPos + rectSize * 0.5;

  // Animation scale around center
  let local = (screen - center) / scale + center;
  let p = local - center;
  let halfSize = rectSize * 0.5;

  let radius = min(cornerRadius, min(halfSize.x, halfSize.y));
  let dist = sdRoundBox(p, halfSize, radius);

  // Outside: keep scene + tight contact shadow below the pane
  let aa = max(fwidth(dist) * 2.2, 1.0);
  let mask = 1.0 - smoothstep(0.0, aa, dist);
  let shadowDist = sdRoundBox(p - vec2f(0.0, 16.0), halfSize, radius);
  var shadow = exp(-max(shadowDist, 0.0) * 0.06) * (1.0 - mask) * shadowStrength * 0.42;
  shadow *= saturate(dist / 8.0); // gap: no dark halo hugging the border
  var outCol = textureSampleLevel(sceneTex, samp, uv, 0.0).rgb;
  outCol *= 1.0 - shadow * 0.6;
  outCol = mix(outCol, outCol * vec3f(0.42, 0.45, 0.56), shadow * 0.3);

  if (mask < 0.001) {
    return vec4f(outCol, 1.0);
  }

  // ---- Refraction: constructive monotonic offset field ----
  // A physical double-interface solve yields a bell-shaped offset profile;
  // non-monotonic sampling folds the background (mirrored ghosts at the rim).
  // UI glass must show ONE continuous image, so the offset is built directly
  // along the radial axis: a small inward lens term near the center blends
  // into an outward bend term that grows to the border. Both amplitudes vary
  // monotonically along the radius, so the composed mapping is monotonic.

  // Radial direction: ELLIPTICAL field (not the n=4 superellipse). The
  // superellipse gradient q³ has a curvature seam on the |qx|=|qy| diagonal
  // — the value is continuous (C¹) but the direction's rate of change jumps
  // there, which prints the faint "crease". The pure ellipse normalize(q)
  // is C∞ everywhere (no corner, no seam), still anisotropic (respects the
  // pane aspect), and — since the offset amplitude is ~0 near center — the
  // center singularity is harmless. This removes the diagonal crease.
  let q = p / max(halfSize, vec2f(1.0));
  let dirOut = q / max(length(q), 1e-4);

  let bandW = max(bevel, 8.0);

  // Smooth inside-distance for every weight below (rim band, offset band,
  // gloss, height field): the pane SDF with its bisector-flipping max()
  // smoothed. Border-faithful and px-scale-exact, unlike a superellipse
  // radius (whose corner overshoot saturated the rim into white wedges).
  let ds = -sdRoundBoxSmooth(p, halfSize, radius);
  let inR = max(min(halfSize.x, halfSize.y), 1.0);

  let edgeT = 1.0 - saturate(ds / bandW); // 0 body → 1 border (rim optics)
  let edge01 = edgeT;

  // Offset transition band: wider than the optical bevel (~2.2×) so the
  // background shears gently, capped by the pane inradius so small windows
  // keep a coherent flat middle. The 96px floor is clamped to the inradius
  // so control-tier panes (inR ≈ 13px) don't turn fully into transition.
  let offBand = min(max(bandW * 2.2, min(96.0, inR * 0.8)), inR * 0.55);
  let offT = 1.0 - saturate(ds / offBand); // 0 body → 1 border (wide ramp)

  let ctx = SurfaceCtx(
    halfSize,
    radius,
    bevel,
    depth,
    0.12,
    curvature,
    liquidity * depth * 0.06,
    time * liquidSpeed,
  );
  let h0 = surfaceHeight(ctx, p);

  // Single C2 weight for the whole handoff. The onset line d = offBand is
  // straight on long edges, so any non-zero derivative there prints a
  // visible crease. smootherstep has f' = f'' = 0 at both ends, and sharing
  // it between lens and bend makes their handoff a plain linear blend — the
  // old pow(t, 1.6) lens fade had an infinite 2nd derivative at t = 0, and
  // that magnification-gradient spike was the crease.
  let bendS = offT * offT * offT * (offT * (offT * 6.0 - 15.0) + 10.0);

  // Body lens: fixed slight magnification (inward sampling) — decoupled from
  // curvature, which shapes the surface highlight only, never the content.
  let lensMag = (ior - 1.0) * 0.05 * edgeBoost;
  let lensOffset = -p * lensMag * (1.0 - bendS);
  // Band bend: outward offset growing monotonically to the border.
  // Fold-proof by construction: the peak sampling slope is
  // 1.875 * (bendAmp + lensMag * |p|max) / offBand, so the cap subtracts the
  // lens contribution from the budget — the total can never reach 1 (a fold
  // prints content jumps: a scene strip sampled twice, neighbours skipped).
  let bendAmp = max(
    min(
      // Relative clamp floor: an absolute 6px floor would swallow the whole
      // band on control-tier panes (bevel ≈ 10px).
      clamp(sceneDistance * 0.12, bandW * 0.1, bandW * 0.55) * edgeBoost,
      offBand * 0.45 - lensMag * length(halfSize),
    ),
    0.0,
  );
  let bendOffset = dirOut * bendAmp * bendS;

  // Liquid ripple (default 0 — the glass is static). Uniform branch.
  var liqOff = vec2f(0.0);
  if (liquidity > 0.0) {
    let nq = p / max(halfSize, vec2f(1.0));
    let lq1 = fbm2(nq * 1.7 + vec2f(time * liquidSpeed, -time * liquidSpeed * 0.7)) - 0.5;
    let lq2 = fbm2(nq * 2.3 - vec2f(time * liquidSpeed * 0.5, time * liquidSpeed * 0.9)) - 0.5;
    liqOff = vec2f(lq1, lq2) * liquidity * depth * 0.15;
  }

  let offG = lensOffset + bendOffset + liqOff;
  let roughEff = clamp(roughness * (0.45 + 0.55 * edge01), 0.0, 1.0);
  // Uniform branch: dispersion == 0 collapses three scene samples into one.
  var body: vec3f;
  if (dispersion > 0.0) {
    let offR = offG * (1.0 + dispersion);
    let offB = offG * (1.0 - dispersion);
    let colR = sampleScene(uv + offR / viewport, roughEff).r;
    let colG = sampleScene(uv + offG / viewport, roughEff).g;
    let colB = sampleScene(uv + offB / viewport, roughEff).b;
    body = vec3f(colR, colG, colB);
  } else {
    body = sampleScene(uv + offG / viewport, roughEff);
  }

  // Path length from the droplet dome (thick apex, thin rim)
  let path = max(2.0 * h0, 2.0);
  let absorb = exp(-absorption * path * 0.02);
  body *= tint * absorb * transmission;
  let milk = saturate(milkiness * (0.4 + 0.6 * (1.0 - edgeT)));
  body = mix(body, tint * vec3f(0.985, 0.985, 1.0) * absorb, milk * transmission);

  // Dome normal for lighting only (refraction no longer touches the surface)
  let e = 2.0; // finite-difference step (px) for the dome gradient
  let hR = surfaceHeight(ctx, p + vec2f(e, 0.0));
  let hL = surfaceHeight(ctx, p - vec2f(e, 0.0));
  let hD = surfaceHeight(ctx, p + vec2f(0.0, e));
  let hU = surfaceHeight(ctx, p - vec2f(0.0, e));
  var grad = vec2f(hR - hL, hD - hU) / (2.0 * e);
  grad *= edgeBoost;
  let N = normalize(vec3f(-grad, 1.0));

  let V = vec3f(0.0, 0.0, 1.0);
  let I = vec3f(0.0, 0.0, -1.0);

  // ---- Authored radial gloss ----
  // Schlick Fresnel cannot shape this transition: the dome slopes stay under
  // ~20°, so (1-cosθ)^5 never lifts F above f0 ≈ 0.04 — the term is flat
  // across the whole pane and any ramp multiplying it is invisible. The
  // visible step was the shoulder ring gated on the 52px bevel band. The
  // swell is authored directly on the pane radius instead: monotonic from a
  // clear center to a bright rim, C1 everywhere; curvature widens/tightens
  // it. Nothing but the thin silhouette line lives inside the band.
  let lightDir = normalize(vec3f(-0.35, 0.5, 0.8));
  let halfV = normalize(lightDir + V);
  let specPow = mix(220.0, 24.0, roughEff);
  let spec = pow(saturate(dot(N, halfV)), specPow);

  // Env light color: gentle LINEAR tilt with the reflection direction.
  // The old softboxes had smoothstep knees on R.z / R.x; amplified normals
  // (edgeBoost) sweep R across the whole reachable range, and wherever the
  // sweep crosses a knee, a bright line prints along the height-slope
  // iso-lines — the diagonal crease. No knees inside the reachable range,
  // no crease; radial structure comes from the authored gloss weight only.
  let R = reflect(I, N);
  let tilt = saturate(R.x * 0.25 + 0.5);
  let envBright = mix(vec3f(0.88, 0.93, 1.0), vec3f(1.0, 0.99, 0.96), tilt);

  let bodyT = saturate(ds / inR);
  let glossFall = 1.2 + curvature * 0.5;
  let gloss = pow(1.0 - bodyT, glossFall);
  let w = min(0.26 * gloss * specular, 0.38);
  var glass = body * (1.0 - w * 0.35) + envBright * w;

  // Thin bright line at the silhouette (last ~30px, gentle rise)
  glass += vec3f(0.9, 0.95, 1.0) * pow(edgeT, 3.5) * (0.18 + 0.12 * hover) * specular;
  // Polished edge hairline (last ~3px): seals the seam where the refracted
  // background meets the undisplaced outside. May clip to white — that is
  // the crisp edge read, not a bug.
  glass += vec3f(0.95, 0.98, 1.0) * pow(edgeT, 12.0) * 0.22 * specular;

  // Interaction trims (control tier): additive only, no smoothstep knees —
  // an amplified normal sweep crossing a knee prints iso-lines (the 45°
  // crease lesson). Hover breathes on the rim; press dims the body while
  // the shell raises shadowStrength for the lift.
  glass *= 1.0 - press * 0.06;
  glass += vec3f(1.0, 0.98, 0.95) * spec * 0.9 * specular;

  // ---- Content as inner film (stable: no parallax → no edge smear) ----
  // contentPad: the film texture covers rect + pad on every side (crop
  // headroom against device-pixel rounding). Map the rect back into the
  // padded texture 1:1 — no stretch, edges intact.
  let pad = max(u.params4.x, 0.0);
  let localFromTopLeft = (local - rectPos) / rectSize;
  let contentUV = clamp(
    (localFromTopLeft * rectSize + vec2f(pad)) / (rectSize + vec2f(2.0 * pad)),
    vec2f(0.0),
    vec2f(1.0),
  );

  let content = textureSampleLevel(contentTex, contentSamp, contentUV, 0.0);
  glass = glass * (1.0 - content.a) + content.rgb;

  // Subtle top specular streak for title area
  if (localFromTopLeft.y * rectSize.y < titleBarHeight) {
    let ty = 1.0 - localFromTopLeft.y * rectSize.y / max(titleBarHeight, 1.0);
    glass += vec3f(1.0) * pow(ty, 3.0) * 0.04 * specular;
  }

  let finalRgb = mix(outCol, glass, mask * opacity);
  return vec4f(finalRgb, 1.0);
}
`;
