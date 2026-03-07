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
uniform vec2 u_mouse_delta;
uniform float u_mouse_active;
uniform int u_brush_mode;
uniform float u_mutation;
uniform float u_seed;
uniform float u_brush_size;
uniform float u_flow;

in vec2 v_texCoord;
out vec4 fragColor;

float hash(vec2 p) {
    p = fract(p * vec2(438.21, 211.73));
    p += dot(p, p + 47.33);
    return fract(p.x * p.y);
}

vec2 flowField(vec2 uv, float time) {
    vec2 p = uv - 0.5;
    vec2 field = vec2(
        sin(uv.y * 11.0 + time * 0.33 + u_seed * 6.2832),
        cos(uv.x * 13.0 - time * 0.29 + u_seed * 4.7124)
    );
    field += vec2(-p.y, p.x) * (1.1 + 0.7 * sin(time * 0.21 + length(p) * 18.0));
    return field * 0.5;
}

void main() {
    vec2 px = 1.0 / u_resolution;
    vec2 advect = flowField(v_texCoord, u_time) * px * (0.35 + u_flow * 1.4);
    vec2 uv = v_texCoord - advect;

    vec4 c  = texture(u_state, uv);
    vec4 n  = texture(u_state, uv + vec2(0.0,   px.y));
    vec4 s  = texture(u_state, uv - vec2(0.0,   px.y));
    vec4 e  = texture(u_state, uv + vec2(px.x,  0.0));
    vec4 w  = texture(u_state, uv - vec2(px.x,  0.0));
    vec4 ne = texture(u_state, uv + vec2( px.x,  px.y));
    vec4 nw = texture(u_state, uv + vec2(-px.x,  px.y));
    vec4 se = texture(u_state, uv + vec2( px.x, -px.y));
    vec4 sw = texture(u_state, uv - vec2( px.x,  px.y));

    vec2 lapl = (n.rg + s.rg + e.rg + w.rg) * 0.20
              + (ne.rg + nw.rg + se.rg + sw.rg) * 0.05
              - c.rg;

    float A = c.r;
    float B = c.g;
    float pigment = c.b;
    float vitality = c.a;
    float vitalityDiff = (n.a + s.a + e.a + w.a) * 0.20
                       + (ne.a + nw.a + se.a + sw.a) * 0.05
                       - vitality;

    float phase = u_time * (0.016 + u_flow * 0.012) + u_seed * 6.2832;
    float f = 0.037 + 0.014 * sin(phase * 0.61) + 0.006 * sin(phase * 1.73 + 1.0);
    float k = 0.058 + 0.007 * sin(phase * 0.47 + 0.9) + 0.004 * cos(phase * 1.31);

    float reaction = A * B * B;
    float noise = (hash(uv * u_resolution + vec2(u_time * 7.3, u_seed * 91.0)) - 0.5)
                  * u_mutation * 0.010;
    float activity = clamp(B * 1.45 + pigment * 0.75 + (1.0 - A) * 0.22, 0.0, 1.0);
    float dormant = 1.0 - smoothstep(0.0, 0.16, activity);
    float resilience = smoothstep(0.02, 0.55, vitality);
    float localFeed = f + resilience * 0.007 + dormant * (0.002 + 0.004 * (0.5 + 0.5 * sin(u_time * 0.25 + uv.x * 7.0 + uv.y * 9.0)));
    float localKill = k - resilience * 0.002;

    float newA = A + 0.215 * lapl.r - reaction + localFeed * (1.0 - A) + noise;
    float newB = B + 0.108 * lapl.g + reaction - (localFeed + localKill) * B - noise * 0.5;

    pigment = pigment * (0.978 - u_flow * 0.012) + B * (0.024 + u_flow * 0.011) + activity * 0.002;

    for (int i = 0; i < 5; i++) {
        float fi   = float(i);
        float ph   = fi * 1.5708 + u_seed * 6.2832;
        float spdR = 0.11 + fi * 0.035;
        float spdT = 0.13 + fi * 0.028;
        vec2 pos = vec2(
            0.5 + (0.26 + fi * 0.04) * sin(u_time * spdR + ph),
            0.5 + (0.21 + fi * 0.03) * cos(u_time * spdT + ph)
        );
        float d     = distance(v_texCoord, pos);
        float burst = (1.0 - smoothstep(0.0, 0.014, d))
                    * (0.5 + 0.5 * sin(u_time * 2.3 + fi * 1.2));
        newA -= burst * 0.55;
        newB += burst * 0.50;
        pigment += burst * 0.06;
        vitality += burst * 0.04;
    }

    float ember = dormant * (0.003 + vitality * 0.011)
                * (0.35 + 0.65 * hash(floor(uv * u_resolution * 0.12) + vec2(floor(u_time * 0.6), u_seed * 100.0)));
    newA -= ember * 0.34;
    newB += ember;

    if (u_mouse_active > 0.5) {
        float d = distance(v_texCoord * u_resolution, u_mouse);
        float radial = d / max(u_brush_size, 1.0);
        float brush = 1.0 - smoothstep(0.0, 1.0, radial);
        float ring = smoothstep(0.68, 1.16, radial) * (1.0 - smoothstep(1.16, 1.7, radial));
        float gesture = clamp(length(u_mouse_delta) / max(u_brush_size, 1.0), 0.0, 1.0);

        if (u_brush_mode == 1) {
            newA = mix(newA, 0.98, brush * 0.84);
            newB *= 1.0 - brush * 0.9;
            pigment *= 1.0 - brush * 0.22;
            newA -= ring * (0.16 + gesture * 0.12);
            newB += ring * (0.18 + gesture * 0.24);
            pigment += ring * 0.16;
            vitality += ring * 0.28 + brush * 0.06;
        } else {
            newA = mix(newA, 0.34 + 0.08 * gesture, brush * 0.78);
            newB += brush * (0.38 + 0.22 * gesture);
            pigment += brush * (0.10 + 0.08 * gesture) + ring * 0.05;
            vitality += brush * 0.14;
        }
    }

    vitality += (0.17 + activity * 0.88 - vitality) * 0.055 + vitalityDiff * 0.18;

    fragColor = vec4(
        clamp(newA,    0.0, 1.0),
        clamp(newB,    0.0, 1.0),
        clamp(pigment, 0.0, 1.0),
        clamp(vitality, 0.0, 1.0)
    );
}
`;

export const RENDER_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_bloom;
uniform float u_flow;
uniform float u_interaction;
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
vec3 ember(float t, float time) {
    return hsl(0.98 - 0.11 * t + 0.04 * sin(time * 0.08 + t * 4.0), 0.92 - t * 0.18, 0.04 + t * 0.56);
}

vec3 pal(int mode, float t, float time) {
    if (mode == 1) return solar(t, time);
    if (mode == 2) return aurora(t, time);
    if (mode == 3) return moss(t, time);
    if (mode == 4) return ember(t, time);
    return biolum(t, time);
}

void main() {
    vec2 px     = 1.0 / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    vec2 centered = v_texCoord - 0.5;
    float dist    = length(centered * vec2(aspect, 1.0));
    vec2 shimmer = centered * (0.006 + u_flow * 0.012) * sin(u_time * 0.45 + dist * 24.0);

    float aberr   = 0.0025 * u_bloom * (0.7 + 0.3 * sin(u_time * 0.5));
    vec2 aberrDir = normalize(centered + 1e-5) * aberr * dist;

    float Br      = texture(u_state, v_texCoord + aberrDir + shimmer).g;
    float Bg      = texture(u_state, v_texCoord).g;
    float Bb      = texture(u_state, v_texCoord - aberrDir - shimmer).g;
    float pigment = texture(u_state, v_texCoord + shimmer * 0.35).b;
    float vitality = texture(u_state, v_texCoord - shimmer * 0.2).a;

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

    vec3 color = vec3(
        pal(u_palette, clamp(Br * 1.6, 0.0, 1.0), u_time).r,
        pal(u_palette, clamp(Bg * 1.6, 0.0, 1.0), u_time).g,
        pal(u_palette, clamp(Bb * 1.6, 0.0, 1.0), u_time).b
    );

    color += pal(u_palette, clamp(bloomVal * 2.2, 0.0, 1.0), u_time)
           * smoothstep(0.05, 0.65, bloomVal) * u_bloom * 1.5;

    vec3 trail = pal(u_palette, clamp(pigment * 1.3, 0.0, 1.0), u_time) * 0.35;
    color = max(color, trail);

    float ep = 0.55 + 0.45 * sin(u_time * 2.8 + dist * 10.0);
    color += vec3(edge * 0.65 * ep, edge * 0.30 * ep, edge * ep);

    float hazePulse = 0.5 + 0.5 * sin(u_time * 0.8 + dist * 18.0 + vitality * 5.0);
    color += pal(u_palette, clamp(vitality * 0.75 + pigment * 0.35, 0.0, 1.0), u_time + 1.4)
           * (0.08 + 0.18 * hazePulse * vitality)
           * (1.0 - smoothstep(0.08, 0.92, dist));

    float caustic = 0.5 + 0.5 * sin((dist - pigment * 0.32) * (24.0 + u_flow * 20.0) - u_time * (1.0 + u_flow));
    color += pal(u_palette, clamp(vitality + caustic * 0.2, 0.0, 1.0), u_time + 3.0) * caustic * vitality * 0.08;

    float interactionPrism = (0.5 + 0.5 * sin((centered.x + centered.y) * 42.0 + u_time * 1.9))
                           * u_interaction * (0.2 + 0.8 * vitality);
    color += pal(u_palette, clamp(Bg + interactionPrism * 0.4, 0.0, 1.0), u_time + 4.0) * interactionPrism * 0.16;

    float scan = 0.965 + 0.035 * sin(v_texCoord.y * u_resolution.y * 1.5708);
    color *= scan;

    color *= 1.0 - smoothstep(0.12, 1.35, dist * dist);

    color += (hash(v_texCoord * u_resolution + vec2(0.0, u_time * 97.0)) - 0.5) * 0.025;

    color  = color / (1.0 + color * 0.80);
    color  = pow(max(color, 0.0), vec3(0.88));

    fragColor = vec4(color, 1.0);
}
`;
