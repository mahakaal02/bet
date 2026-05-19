/**
 * Stage selector — flips between the classic plane stage and the new
 * astronaut-on-rocket art based on the build-time env flag
 * `NEXT_PUBLIC_AVIATOR_ROCKET`. Set the flag to `"1"` in the build args
 * to ship the rocket art; omit / leave empty to keep the plane.
 *
 * The flag is read once at module-load (Next.js inlines NEXT_PUBLIC_*
 * at build time anyway) so the chosen stage is baked into the bundle
 * and the unused component tree-shakes out.
 */
import PlaneStage from './PlaneStage';
import RocketStage from './RocketStage';

const USE_ROCKET = process.env.NEXT_PUBLIC_AVIATOR_ROCKET === '1';

export default function Stage() {
  return USE_ROCKET ? <RocketStage /> : <PlaneStage />;
}
