// ParticleSystem.js - Fast visual FX: Tracers, Muzzle Flash, Ejected Shells, Sparks
import * as THREE from '../vendor/three/three.module.js';

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.sparks = [];
    this.shells = [];
    this.confetti = [];

    // Shared materials & geometries for maximum performance
    this.tracerMaterial = new THREE.LineBasicMaterial({
      color: 0xfff0aa,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      linewidth: 2
    });

    this.sparkGeo = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array([0, 0, 0]);
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));

    this.shellGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.07, 6);
    this.shellMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Brass gold
      metalness: 0.85,
      roughness: 0.25
    });
  }

  // Bullet tracer from barrel position to hit position
  addTracer(startVec, endVec) {
    const points = [startVec.clone(), endVec.clone()];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geom, this.tracerMaterial.clone());
    this.scene.add(line);

    this.tracers.push({
      mesh: line,
      life: 0.18,
      maxLife: 0.18
    });
  }

  // Wall impact spark burst
  addImpact(point, normal, color = 0xffcc44, count = 12) {
    for (let i = 0; i < count; i++) {
      const pMat = new THREE.PointsMaterial({
        color: color,
        size: 0.08 + Math.random() * 0.06,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending
      });
      const spark = new THREE.Points(this.sparkGeo.clone(), pMat);
      spark.position.copy(point);

      // Random velocity oriented around surface normal
      const vel = normal.clone().multiplyScalar(2.0 + Math.random() * 4.0);
      vel.x += (Math.random() - 0.5) * 4.0;
      vel.y += (Math.random() - 0.5) * 4.0;
      vel.z += (Math.random() - 0.5) * 4.0;

      this.scene.add(spark);
      this.sparks.push({
        mesh: spark,
        vel: vel,
        life: 0.35 + Math.random() * 0.2,
        maxLife: 0.5
      });
    }
  }

  // Shell casing ejected from sniper rifle
  ejectShell(startPos, rightDir, upDir) {
    const shell = new THREE.Mesh(this.shellGeo, this.shellMat);
    shell.position.copy(startPos);
    this.scene.add(shell);

    // Initial velocity: pops up and to the right
    const vel = rightDir.clone().multiplyScalar(1.8 + Math.random() * 0.6)
      .add(upDir.clone().multiplyScalar(1.2 + Math.random() * 0.5));

    const rotVel = new THREE.Vector3(
      (Math.random() - 0.5) * 25,
      (Math.random() - 0.5) * 25,
      (Math.random() - 0.5) * 25
    );

    this.shells.push({
      mesh: shell,
      vel: vel,
      rotVel: rotVel,
      life: 1.8
    });
  }

  // Confetti burst on match victory
  spawnVictoryConfetti(origin) {
    const colors = [0x00d2ff, 0xffaa00, 0xff0055, 0x00ff88, 0xffffff];
    for (let i = 0; i < 80; i++) {
      const geo = new THREE.PlaneGeometry(0.12, 0.12);
      const mat = new THREE.MeshBasicMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(origin).add(new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 3,
        (Math.random() - 0.5) * 8
      ));
      this.scene.add(mesh);
      this.confetti.push({
        mesh: mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          2.0 + Math.random() * 3.0,
          (Math.random() - 0.5) * 3
        ),
        rotVel: new THREE.Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5),
        life: 4.0
      });
    }
  }

  update(delta) {
    // 1. Update bullet tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= delta;
      t.mesh.material.opacity = Math.max(0, t.life / t.maxLife);
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.mesh.material.dispose();
        this.tracers.splice(i, 1);
      }
    }

    // 2. Update sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= delta;
      s.mesh.position.addScaledVector(s.vel, delta);
      s.vel.y -= 9.8 * delta; // Gravity
      s.mesh.material.opacity = Math.max(0, s.life / s.maxLife);

      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this.sparks.splice(i, 1);
      }
    }

    // 3. Update ejected shells
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.life -= delta;
      sh.mesh.position.addScaledVector(sh.vel, delta);
      sh.vel.y -= 12.0 * delta; // Shell gravity
      sh.mesh.rotation.x += sh.rotVel.x * delta;
      sh.mesh.rotation.y += sh.rotVel.y * delta;
      sh.mesh.rotation.z += sh.rotVel.z * delta;

      // Bounce on floor
      if (sh.mesh.position.y < 0.05) {
        sh.mesh.position.y = 0.05;
        sh.vel.y *= -0.4;
        sh.vel.x *= 0.6;
        sh.vel.z *= 0.6;
      }

      if (sh.life <= 0) {
        this.scene.remove(sh.mesh);
        this.shells.splice(i, 1);
      }
    }

    // 4. Update confetti
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.life -= delta;
      c.mesh.position.addScaledVector(c.vel, delta);
      c.vel.y -= 3.0 * delta; // Flutter gravity
      c.vel.x += Math.sin(c.life * 5) * 0.05;
      c.mesh.rotation.x += c.rotVel.x * delta;
      c.mesh.rotation.y += c.rotVel.y * delta;

      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mesh.material.dispose();
        this.confetti.splice(i, 1);
      }
    }
  }
}
