export const VERTEX_SHADER = `#version 300 es
in vec2 position;
out vec2 v_texCoord;

void main() {
    v_texCoord = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const UPDATE_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_mouse_active;
uniform float u_mutation;
uniform float u_seed;
uniform float u_brush_size;

in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) {
    p = fract(p * vec2(438.21, 211.73));
    p += dot(p, p + 47.33);
    return fract(p.x * p.y);
}

void main() {
    vec2 px = 1.0 / u_resolution;

    vec4 c  = texture(u_state, v_texCoord);
    vec4 n  = texture(u_state, v_texCoord + vec2(0.0,   px.y));
    vec4 s  = texture(u_state, v_texCoord - vec2(0.0,   px.y));
    vec4 e  = texture(u_state, v_texCoord + vec2(px.x,  0.0));
    vec4 w  = texture(u_state, v_texCoord - vec2(px.x,  0.0));
    vec4 ne = texture(u_state, v_texCoord + vec2( px.x,  px.y));
    vec4 nw = texture(u_state, v_texCoord + vec2(-px.x,  px.y));
    vec4 se = texture(u_state, v_texCoord + vec2( px.x, -px.y));
    vec4 sw = texture(u_state, v_texCoord - vec2( px.x,  px.y));

    // Weighted discrete Laplacian (sums to zero — correct for diffusion)
    vec2 lapl = (n.rg + s.rg + e.rg + w.rg) * 0.20
              + (ne.rg + nw.rg + se.rg + sw.rg) * 0.05
              - c.rg;

    float A = c.r;
    float B = c.g;
    float pigment = c.b;

    // Gray-Scott parameters drift slowly through interesting pattern regimes:
    // worms → coral → spots → maze → back, endlessly
    float phase = u_time * 0.022 + u_seed * 6.2832;
    float f = 0.037 + 0.014 * sin(phase * 0.61) + 0.006 * sin(phase * 1.73 + 1.0);
    float k = 0.058 + 0.007 * sin(phase * 0.47 + 0.9) + 0.004 * cos(phase * 1.31);

    float reaction = A * B * B;
    float noise = (hash(v_texCoord * u_resolution + vec2(u_time * 7.3, u_seed * 91.0)) - 0.5)
                  * u_mutation * 0.010;

    float newA = A + 0.210 * lapl.r - reaction + f * (1.0 - A) + noise;
    float newB = B + 0.105 * lapl.g + reaction - (f + k) * B  - noise * 0.5;

    // Pigment channel: slow accumulation of B activity → glowing trails
    pigment = pigment * 0.982 + B * 0.022;

    // Four orbiting pulse injectors — continuously seed B into the system
    for (int i = 0; i < 4; i++) {
        float fi   = float(i);
        float ph   = fi * 1.5708 + u_seed * 6.2832;
        float spdR = 0.11 + fi * 0.035;
        float spdT = 0.13 + fi * 0.028;
        vec2 pos = vec2(
            0.5 + (0.26 + fi * 0.04) * sin(u_time * spdR + ph),
            0.5 + (0.21 + fi * 0.03) * cos(u_time * spdT + ph)
        );
        float d     = distance(v_texCoord, pos);
        float burst = smoothstep(0.014, 0.0, d)
                    * (0.5 + 0.5 * sin(u_time * 2.3 + fi * 1.2));
        newA -= burst * 0.55;
        newB += burst * 0.50;
    }

    // Mouse: inject B, deplete A
    if (u_mouse_active > 0.5) {
        float d     = distance(v_texCoord * u_resolution, u_mouse);
        float brush = smoothstep(u_brush_size, 0.0, d);
        newA  = mix(newA, 0.5, brush * 0.75);
        newB += brush * 0.45;
    }

    fragColor = vec4(
        clamp(newA,    0.0, 1.0),
        clamp(newB,    0.0, 1.0),
        clamp(pigment, 0.0, 1.0),
        1.0
    );
}
`;

export const RENDER_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_bloom;
uniform int u_palette;

in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) {
    p = fract(p * vec2(123.45, 456.78));
    p += dot(p, p + 67.89);
    return fract(p.x * p.y);
}

// Smooth HSL to RGB
vec3 hsl(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

vec3 biolum(float t, float time) {
    return hsl(0.54 + 0.07 * sin(time * 0.07) + t * 0.18, 0.92, 0.04 + t * 0.56);
}
vec3 solar(float t, float time) {
    return hsl(0.07 - 0.05 * t + 0.03 * sin(time * 0.09), 0.95, 0.04 + t * 0.58);
}
vec3 aurora(float t, float time) {
    return hsl(0.40 + 0.22 * sin(time * 0.06 + t * 3.14), 0.88, 0.04 + t * 0.54);
}
vec3 moss(float t, float time) {
    return hsl(0.30 + 0.07 * sin(time * 0.08 + t * 2.1), 0.82 - t * 0.22, 0.03 + t * 0.52);
}

vec3 pal(int mode, float t, float time) {
    if (mode == 1) return solar(t, time);
    if (mode == 2) return aurora(t, time);
    if (mode == 3) return moss(t, time);
    return biolum(t, time);
}

void main() {
    vec2 px     = 1.0 / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    vec2 centered = v_texCoord - 0.5;
    float dist    = length(centered * vec2(aspect, 1.0));

    // Animated chromatic aberration — radiates outward from centre
    float aberr   = 0.0025 * u_bloom * (0.7 + 0.3 * sin(u_time * 0.5));
    vec2 aberrDir = normalize(centered + 1e-5) * aberr * dist;

    float Br      = texture(u_state, v_texCoord + aberrDir).g;
    float Bg      = texture(u_state, v_texCoord).g;
    float Bb      = texture(u_state, v_texCoord - aberrDir).g;
    float pigment = texture(u_state, v_texCoord).b;

    // Weighted multi-tap radial bloom
    float bloomVal = 0.0, wt = 0.0;
    for (int i = 1; i <= 4; i++) {
        float r  = float(i) * 2.0;
        float wi = 1.0 / float(i * i);
        bloomVal += (texture(u_state, v_texCoord + vec2(r,   0.0) * px).g
                   + texture(u_state, v_texCoord - vec2(r,   0.0) * px).g
                   + texture(u_state, v_texCoord + vec2(0.0, r  ) * px).g
                   + texture(u_state, v_texCoord - vec2(0.0, r  ) * px).g) * wi;
        wt += 4.0 * wi;
    }
    bloomVal /= wt;

    // Gradient-magnitude edge detection on B channel
    float eL = texture(u_state, v_texCoord - vec2(px.x, 0.0)).g;
    float eR = texture(u_state, v_texCoord + vec2(px.x, 0.0)).g;
    float eD = texture(u_state, v_texCoord - vec2(0.0, px.y)).g;
    float eU = texture(u_state, v_texCoord + vec2(0.0, px.y)).g;
    float edge = length(vec2(eR - eL, eU - eD)) * 3.5;

    // Base colour with per-channel chromatic split
    vec3 color = vec3(
        pal(u_palette, clamp(Br * 1.6, 0.0, 1.0), u_time).r,
        pal(u_palette, clamp(Bg * 1.6, 0.0, 1.0), u_time).g,
        pal(u_palette, clamp(Bb * 1.6, 0.0, 1.0), u_time).b
    );

    // Bloom overlay
    color += pal(u_palette, clamp(bloomVal * 2.2, 0.0, 1.0), u_time)
           * smoothstep(0.05, 0.65, bloomVal) * u_bloom * 1.5;

    // Pigment trail: ghostly afterglow where B has been
    vec3 trail = pal(u_palette, clamp(pigment * 1.3, 0.0, 1.0), u_time) * 0.35;
    color = max(color, trail);

    // Edge glow: time-pulsed, blue/white-biased chromatic fringe
    float ep = 0.55 + 0.45 * sin(u_time * 2.8 + dist * 10.0);
    color += vec3(edge * 0.65 * ep, edge * 0.30 * ep, edge * ep);

    // CRT scanlines — 4-pixel period
    float scan = 0.965 + 0.035 * sin(v_texCoord.y * u_resolution.y * 1.5708);
    color *= scan;

    // Vignette
    color *= smoothstep(1.35, 0.12, dist * dist);

    // Film grain
    color += (hash(v_texCoord * u_resolution + vec2(0.0, u_time * 97.0)) - 0.5) * 0.025;

    // Tone mapping + gamma
    color  = color / (1.0 + color * 0.80);
    color  = pow(max(color, 0.0), vec3(0.88));

    fragColor = vec4(color, 1.0);
}
`;
