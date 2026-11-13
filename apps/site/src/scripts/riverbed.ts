// "Riverbed at night": Paper's water shader, with caustics barely lighter than the background, so the
// board looks like it rests under slow, dark water. Decorative: skipped when the user asks for less motion.
import { ShaderMount, waterFragmentShader, getShaderColorFromString, defaultObjectSizing, ShaderFitOptions, emptyPixel } from '@paper-design/shaders'

export async function mountRiverbed(el: HTMLElement, { highlight = '#3b3b41', size = 0.22, strength = 0.32 } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  // The shader filters an image; with a transparent pixel, only the caustics remain.
  const image = new Image()
  image.src = emptyPixel
  await image.decode().catch(() => {})
  try {
    new ShaderMount(
      el,
      waterFragmentShader,
      {
        u_image: image,
        u_colorBack: getShaderColorFromString('#0d0d0e'),
        u_colorHighlight: getShaderColorFromString(highlight),
        u_highlights: strength,
        u_layering: 0.5,
        u_edges: 0.8,
        u_caustic: 0.1,
        u_waves: 0.3,
        u_size: size,
        // Paper's sizing params, renamed to the uniforms the shader reads.
        // "cover" stretches the (1px) image over the whole element, so the caustics scale with it.
        ...Object.fromEntries(Object.entries(defaultObjectSizing).map(([k, v]) => [`u_${k}`, v])),
        u_fit: ShaderFitOptions.cover,
      } as never,
      undefined,
      reduced ? 0 : 0.35,
      reduced ? 4000 : 0,
      1,
      1920 * 1080,
    )
  } catch {
    // No WebGL: the plain background is fine.
  }
}
