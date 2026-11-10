import { BoxGeometry, Vector3 } from 'three';

/**
 * A box spanning (x1,y1,z1)–(x2,y2,z2), centred on its own origin, whose UVs
 * come from world coordinates. Panels then line up across neighbouring blocks
 * and their seams always fall on whole multiples of `tileLength`.
 */
export function worldBoxGeometry(
  x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, tileLength: number,
): BoxGeometry {
  const geo = new BoxGeometry(x2 - x1, y2 - y1, z2 - z1);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const cz = (z1 + z2) / 2;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    const x = pos.getX(i) + cx;
    const y = pos.getY(i) + cy;
    const z = pos.getZ(i) + cz;
    if (face < 2) uv.setXY(i, z / tileLength, y / tileLength);
    else if (face < 4) uv.setXY(i, x / tileLength, z / tileLength);
    else uv.setXY(i, x / tileLength, y / tileLength);
  }
  uv.needsUpdate = true;
  return geo;
}

/** A box with rounded edges and corners of radius `r`. */
export function roundedBoxGeometry(w: number, h: number, d: number, r: number, segments: number): BoxGeometry {
  const geo = new BoxGeometry(w, h, d, segments, segments, segments);
  const pos = geo.attributes.position;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const hz = d / 2 - r;
  const v = new Vector3();
  const inner = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    inner.set(
      Math.max(-hx, Math.min(hx, v.x)),
      Math.max(-hy, Math.min(hy, v.y)),
      Math.max(-hz, Math.min(hz, v.z)),
    );
    v.sub(inner);
    if (v.lengthSq() > 0) v.setLength(r);
    v.add(inner);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
