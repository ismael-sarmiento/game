// Delivery robots: small six-wheeled boxes that ride round the blocks on the inner side of the sidewalk, stop for
// people and for the player, and show a white headlight and a red tail light at night. One instanced mesh (the parts
// are merged with vertex colours) and a kinematic body each, so the player bumps into them like into a person.
import * as THREE from 'three/webgpu';
import { attribute, vertexColor } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY, blockAt, rng } from './layout.js';
import { NIGHT } from './timeofday.js';
import { GROUPS } from './people.js';

const INSET = CITY.BLOCK / 2 - 3.9;   // between the walkers (2.6 m inside the kerb) and the shop fronts
const SPEED = 1.3;

function robotGeometry() {
  const part = (geo, color, glow = 0) => {
    const c = new THREE.Color(color), n = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    geo.setAttribute('glow', new THREE.Float32BufferAttribute(new Array(n).fill(glow), 1));
    return geo.index ? geo.toNonIndexed() : geo;
  };
  const parts = [
    part(new THREE.BoxGeometry(0.56, 0.38, 0.72).translate(0, 0.42, 0), '#e8e7e2'),           // body
    part(new THREE.BoxGeometry(0.5, 0.06, 0.62).translate(0, 0.64, 0), '#2b2e33'),            // lid
    part(new THREE.BoxGeometry(0.3, 0.05, 0.02).translate(0, 0.5, 0.365), '#ffffff', 1),       // headlight
    part(new THREE.BoxGeometry(0.3, 0.04, 0.02).translate(0, 0.5, -0.365), '#ff2a1f', 1),      // tail light
    part(new THREE.CylinderGeometry(0.008, 0.008, 1.0, 4).translate(-0.22, 1.1, -0.28), '#30333a'),   // flag pole
    part(new THREE.BoxGeometry(0.01, 0.12, 0.2).translate(-0.22, 1.54, -0.18), '#ff7a1a'),    // flag
  ];
  for (const z of [-0.26, 0, 0.26]) for (const x of [-0.3, 0.3]) {
    parts.push(part(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 12).rotateZ(Math.PI / 2).translate(x, 0.1, z), '#1a1b1e'));
  }
  return mergeGeometries(parts.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'glow'].includes(k)) g.deleteAttribute(k); return g; }));
}

export class Robots {
  constructor({ scene, world, RAPIER }, count = 8) {
    const r = rng(203);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.1 });
    mat.colorNode = vertexColor();
    mat.emissiveNode = vertexColor().mul(attribute('glow', 'float')).mul(NIGHT.mul(2.5).add(0.3));
    this.mesh = new THREE.InstancedMesh(robotGeometry(), mat, count);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // each robot rides the loop of one block, clockwise or not, starting somewhere along it
    this.list = Array.from({ length: count }, () => {
      const i = 1 + Math.floor(r() * (CITY.N - 2)), j = 1 + Math.floor(r() * (CITY.N - 2));
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.32, 0.38).setTranslation(0, 0.36, 0).setCollisionGroups(GROUPS.person), body);
      return { cx: blockAt(i), cz: blockAt(j), s: r() * 4, dir: r() < 0.5 ? 1 : -1, wait: 0, body, pos: new THREE.Vector3(), yaw: 0 };
    });
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.up = new THREE.Vector3(0, 1, 0); this.one = new THREE.Vector3(1, 1, 1);
    this.list.forEach((b) => this.place(b));
  }

  // position on the loop: s in [0, 4), one unit per side of the square
  place(b) {
    const side = Math.floor(b.s) % 4, f = b.s - Math.floor(b.s), L = INSET * 2;
    const corners = [[-INSET, -INSET], [INSET, -INSET], [INSET, INSET], [-INSET, INSET]];
    const [ax, az] = corners[side], [bx, bz] = corners[(side + 1) % 4];
    b.pos.set(b.cx + ax + (bx - ax) * f, CITY.CURB, b.cz + az + (bz - az) * f);
    const dx = (bx - ax) * b.dir, dz = (bz - az) * b.dir;
    b.yaw = Math.atan2(dx, dz);
    b.len = L;
  }

  update(dt, { player, people }) {
    this.list.forEach((b, k) => {
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
      // stop when someone is just ahead (the player or anyone of the crowd near enough to matter)
      const blocked = (x, z, reach) => { const dx = x - b.pos.x, dz = z - b.pos.z, ahead = dx * fx + dz * fz; return ahead > 0 && ahead < reach && Math.abs(dx * fz - dz * fx) < 0.9; };
      let stop = blocked(player.x, player.z, 2.2);
      for (let n = 0; !stop && n < people.length; n++) { const p = people[n].pos; if (Math.abs(p.x - b.pos.x) < 3 && Math.abs(p.z - b.pos.z) < 3) stop = blocked(p.x, p.z, 1.6); }
      b.wait = stop ? Math.min(b.wait + dt, 3) : 0;
      if (!stop) { b.s = (b.s + b.dir * SPEED * dt / b.len + 4) % 4; this.place(b); }
      b.body.setNextKinematicTranslation({ x: b.pos.x, y: b.pos.y, z: b.pos.z });
      this.q.setFromAxisAngle(this.up, b.yaw);
      b.body.setNextKinematicRotation(this.q);
      this.m.compose(b.pos, this.q, this.one); this.mesh.setMatrixAt(k, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
