/**
 * Solid glass object shader (v1: sphere) — physical closed-form refraction.
 *
 * The pane glass (shaders.ts GLASS_FS) is authored on purpose: UI panes need a
 * monotonic sampling mapping and their shallow slopes make Fresnel a dead term
 * (see docs/devlog-liquid-glass.md). A decorative 3D solid is the opposite
 * case, so the physical model comes back here:
 *   - silhouette incidence reaches ~90° → Schlick Fresnel lifts for real;
 *   - the folded/inverted background image through the ball is the product;
 *   - a quadric needs NO Newton iteration — every intersection below is
 *     closed-form (the divergence that killed the physical pane route simply
 *     does not exist for a sphere).
 *
 * Camera: ortho straight-on (primary rays (0,0,-1)). The refracted background
 * is sampled from the screen-space scene texture by intersecting the exit ray
 * with the screen-parallel desktop plane at depth D = sceneDistance — the
 * projection degenerates to a pure 2D offset, no camera matrix involved.
 * TIR (ior ≥ ~1.52 rays near the rim) darkens the body — the crystal-ball
 * rim ring, not a bug.
 *
 * Uniform layout must match packGlassUniforms in compositor.ts (9 x vec4).
 */
export const SOLID_FS = /* wgsl */ `
struct GlassUniforms {
  rect: vec4f,
  viewport: vec4f,
  params0: vec4f,
  params1: vec4f,
  params2: vec4f,
  tintCorner: vec4f,
  shapeExtra: vec4f,
  params3: vec4f,
  params4: vec4f,
}

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var blurTex: texture_2d<f32>;
@group(0) @binding(2) var contentTex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var contentSamp: sampler;
@group(0) @binding(5) var<uniform> u: GlassUniforms;

fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

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

struct Refraction {
  exitP: vec3f,
  dir: vec3f,
  path: f32,
  ok: f32,
}

/** Air → glass at entry, chord across the sphere, glass → air. Closed-form. */
fn sphereRefraction(p: vec2f, R: f32, ior: f32) -> Refraction {
  var result: Refraction;
  let b = sqrt(max(R * R - dot(p, p), 0.0));
  let P1 = vec3f(p.x, p.y, b);
  let N1 = P1 / R;
  let safeIor = max(ior, 1.001);
  let T1 = refract(vec3f(0.0, 0.0, -1.0), N1, 1.0 / safeIor);
  // Both endpoints on the sphere ⇒ chord length s = -2·dot(P1, T1)
  let s = max(-2.0 * dot(P1, T1), 0.001);
  let P2 = P1 + T1 * s;
  let N2 = -P2 / R;
  let T2 = refract(T1, N2, safeIor);
  let tir = dot(T2, T2) < 0.001;
  result.exitP = P2;
  result.dir = select(T2, T1, tir); // TIR: ray stays trapped — caller darkens
  result.path = s;
  result.ok = select(1.0, 0.0, tir);
  return result;
}

/** Exit ray ∩ desktop plane (screen-parallel, depth D behind the center). */
fn backgroundUV(uv: vec2f, exitP: vec3f, dir: vec3f, D: f32, viewport: vec2f) -> vec2f {
  // ponytail: grazing exits clamp to bounded offsets; real TIR falloff if it shows
  let dz = max(-dir.z, 0.12);
  let t = (exitP.z + D) / dz;
  return uv + dir.xy * t / viewport;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let viewport = u.viewport.xy;
  let ior = clamp(u.params0.x, 1.01, 2.4);
  let roughness = saturate(u.params0.z);
  let transmission = saturate(u.params0.w);
  let dispersion = max(u.params1.x, 0.0);
  let specular = max(u.params1.y, 0.0);
  let absorption = max(u.params1.w, 0.0);
  let opacity = saturate(u.params2.z);
  let tint = u.tintCorner.xyz;
  let shadowStrength = u.shapeExtra.z;
  let sceneDistance = max(u.params3.x, 1.0);
  let milkiness = saturate(u.params3.y);
  let hover = saturate(u.params3.z);
  let press = saturate(u.params3.w);

  let screen = uv * viewport;
  let rectSize = max(u.rect.zw, vec2f(1.0));
  let center = u.rect.xy + rectSize * 0.5;
  let R = 0.5 * min(rectSize.x, rectSize.y);
  let p = screen - center;
  let dist = length(p) - R;

  let aa = max(fwidth(dist) * 2.2, 1.0);
  let mask = 1.0 - smoothstep(0.0, aa, dist);

  // Contact shadow: ellipse tucked under the sphere
  let sc = p - vec2f(0.0, R * 1.08);
  let se = vec2f(R * 0.92, R * 0.24);
  let sd = length(sc / se);
  var shadow = exp(-max(sd - 0.8, 0.0) * 2.6) * (1.0 - mask) * shadowStrength * 0.5;
  var outCol = textureSampleLevel(sceneTex, samp, uv, 0.0).rgb;
  outCol *= 1.0 - shadow * 0.6;
  outCol = mix(outCol, outCol * vec3f(0.42, 0.45, 0.56), shadow * 0.3);

  if (mask < 0.001) {
    return vec4f(outCol, 1.0);
  }

  // ---- Physical refraction with per-channel dispersion ----
  let D = max(sceneDistance, 80.0);
  let rG = sphereRefraction(p, R, ior);
  // Sampling derivative explodes where the exit ray bends hard (rim) — the
  // per-channel offsets diverge there and print aliased RGB stripes. Roughen
  // with the bend magnitude so high-displacement regions fall back to the
  // blurred chain (same idea as the pane's edge-keyed roughEff).
  let roughEff = saturate(roughness + length(rG.dir.xy) * 0.3);
  let bgG = backgroundUV(uv, rG.exitP, rG.dir, D, viewport);
  // Uniform branch: dispersion == 0 skips two full refraction chains.
  var body: vec3f;
  var tir = rG.ok;
  if (dispersion > 0.0) {
    let rR = sphereRefraction(p, R, ior * (1.0 + dispersion));
    let rB = sphereRefraction(p, R, ior * (1.0 - dispersion));
    tir = rG.ok * rR.ok * rB.ok;
    let colR = sampleScene(backgroundUV(uv, rR.exitP, rR.dir, D, viewport), roughEff).r;
    let colG = sampleScene(bgG, roughEff).g;
    let colB = sampleScene(backgroundUV(uv, rB.exitP, rB.dir, D, viewport), roughEff).b;
    body = vec3f(colR, colG, colB);
  } else {
    body = sampleScene(bgG, roughEff);
  }

  // TIR rim (trapped light → dark ring) + Beer-Lambert over the chord
  let absorb = exp(-absorption * rG.path * 0.02);
  body *= tint * absorb * transmission * mix(0.2, 1.0, tir);
  body = mix(body, tint * vec3f(0.985, 0.985, 1.0) * absorb, milkiness * transmission);

  // ---- Real Fresnel (unlike the pane, the slopes here reach 90°) ----
  let b = sqrt(max(R * R - dot(p, p), 0.0));
  let cosI = b / R;
  let f0 = (ior - 1.0) / (ior + 1.0);
  let F = f0 * f0 + (1.0 - f0 * f0) * pow(1.0 - cosI, 5.0);
  let N1 = vec3f(p.x, p.y, b) / R;
  let R1 = reflect(vec3f(0.0, 0.0, -1.0), N1);
  // Env: linear tilt only — knees print iso-lines (the 45° crease lesson)
  let tilt = saturate(R1.x * 0.25 + 0.5);
  let envBright = mix(vec3f(0.88, 0.93, 1.0), vec3f(1.0, 0.99, 0.96), tilt);
  let specPow = mix(220.0, 24.0, roughEff);
  let lightDir = normalize(vec3f(-0.35, 0.5, 0.8));
  let spec = pow(saturate(dot(R1, lightDir)), specPow);

  let w = min(F * specular * 1.6, 1.0);
  var glass = body * (1.0 - w * 0.5) + envBright * w;

  let edgeT = 1.0 - saturate(length(p) / R);
  glass *= 1.0 - press * 0.06;
  // Hairline seals the silhouette seam (same idiom as the pane)
  glass += vec3f(0.95, 0.98, 1.0) * pow(edgeT, 14.0) * 0.28 * specular;
  glass += vec3f(1.0, 0.98, 0.95) * spec * 0.9 * specular;
  glass += vec3f(0.9, 0.95, 1.0) * pow(edgeT, 3.5) * 0.12 * hover * specular;

  let finalRgb = mix(outCol, glass, mask * opacity);
  return vec4f(finalRgb, 1.0);
}
`;
