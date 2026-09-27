import * as THREE from "three";
import type { LampConfig, UV, Vec2 } from "../types";
import { EPSILON, lerp } from "./math";

export class FrustumSurface {
  readonly bottomRadiusMm: number;
  readonly topRadiusMm: number;
  readonly heightMm: number;

  constructor(config: Pick<LampConfig, "bottomRadiusMm" | "topRadiusMm" | "heightMm">) {
    this.bottomRadiusMm = config.bottomRadiusMm;
    this.topRadiusMm = config.topRadiusMm;
    this.heightMm = config.heightMm;
  }

  radiusAtZ(z: number): number {
    return lerp(this.bottomRadiusMm, this.topRadiusMm, z / this.heightMm);
  }

  slopeDrDz(): number {
    return (this.topRadiusMm - this.bottomRadiusMm) / this.heightMm;
  }

  slantHeightMm(): number {
    return Math.hypot(this.heightMm, this.bottomRadiusMm - this.topRadiusMm);
  }

  isCylinder(): boolean {
    return Math.abs(this.bottomRadiusMm - this.topRadiusMm) < EPSILON;
  }

  unrolledSectorAngleRad(): number {
    if (this.isCylinder()) return Math.PI * 2;
    return (Math.PI * 2 * Math.abs(this.bottomRadiusMm - this.topRadiusMm)) / this.slantHeightMm();
  }

  unrolledWidthAtBottomMm(): number {
    return Math.PI * 2 * this.bottomRadiusMm;
  }

  uvToPoint(uv: UV, normalOffsetMm = 0): THREE.Vector3 {
    const radius = this.radiusAtZ(uv.z);
    const base = new THREE.Vector3(
      radius * Math.cos(uv.theta),
      uv.z,
      radius * Math.sin(uv.theta)
    );

    if (normalOffsetMm === 0) return base;
    return base.add(this.uvToNormal(uv).multiplyScalar(normalOffsetMm));
  }

  uvToNormal(uv: UV): THREE.Vector3 {
    const drDz = this.slopeDrDz();
    return new THREE.Vector3(
      Math.cos(uv.theta),
      -drDz,
      Math.sin(uv.theta)
    ).normalize();
  }

  uvToFlat(uv: UV): Vec2 {
    const radius = this.radiusAtZ(uv.z);

    if (this.isCylinder()) {
      return {
        x: uv.theta * this.bottomRadiusMm,
        y: uv.z
      };
    }

    const slantHeight = this.slantHeightMm();
    const alpha = Math.abs(this.bottomRadiusMm - this.topRadiusMm) / slantHeight;
    const flatRadius = radius / alpha;
    const flatAngle = uv.theta * alpha;

    return {
      x: flatRadius * Math.cos(flatAngle),
      y: flatRadius * Math.sin(flatAngle)
    };
  }

  flatToUv(point: Vec2): UV {
    if (this.isCylinder()) {
      return {
        theta: point.x / Math.max(this.bottomRadiusMm, EPSILON),
        z: point.y
      };
    }

    const slantHeight = this.slantHeightMm();
    const alpha = Math.abs(this.bottomRadiusMm - this.topRadiusMm) / slantHeight;
    const flatRadius = Math.hypot(point.x, point.y);
    const flatAngle = ((Math.atan2(point.y, point.x) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const radius = flatRadius * alpha;
    const z = ((radius - this.bottomRadiusMm) / (this.topRadiusMm - this.bottomRadiusMm)) * this.heightMm;

    return {
      theta: flatAngle / alpha,
      z
    };
  }

  uvLerp(a: UV, b: UV, t: number): UV {
    return {
      theta: lerp(a.theta, b.theta, t),
      z: lerp(a.z, b.z, t)
    };
  }
}
