// Controls.js - Desktop PointerLock + Touch Virtual Joystick & Drag Engine
import * as THREE from '../vendor/three/three.module.js';

export class FPSControls {
  constructor(camera, domElement, mapGenerator) {
    this.camera = camera;
    this.domElement = domElement;
    this.map = mapGenerator;

    this.isLocked = false;
    this.isGameActive = false;
    this.enabled = true;
    this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    // Camera pitch & yaw
    this.yawObject = new THREE.Group();
    this.yawObject.position.set(0, 0.5, -100); // Start in Lobby
    this.pitchObject = new THREE.Group();
    this.pitchObject.position.y = 1.75;
    this.yawObject.add(this.pitchObject);
    this.pitchObject.add(this.camera);

    this.pitch = 0;
    this.yaw = 0;
    this.mouseSensitivity = 0.0022;

    // Movement Physics
    this.velocity = new THREE.Vector3();
    this.moveInput = { forward: false, backward: false, left: false, right: false };
    this.joystickVector = { x: 0, y: 0 };
    this.isSprinting = false;
    this.isCrouching = false;
    this.canJump = false;

    // Slide Mechanics
    this.isSliding = false;
    this.slideTimer = 0;
    this.slideDuration = 0.72;
    this.slideDir = new THREE.Vector3();
    this.normalEyeHeight = 1.75;
    this.slideEyeHeight = 0.95;
    this.currentEyeHeight = 1.75;

    this.baseSpeed = 9.0;
    this.sprintMultiplier = 1.35;
    this.crouchMultiplier = 0.6;
    this.jumpForce = 7.5;
    this.gravity = 24.0;
    this.friction = 12.0;

    // Player Collision Bounding Box (AABB)
    this.playerRadius = 0.45;
    this.playerHeight = 1.8;
    this.playerBox = new THREE.Box3();

    // Unified Pointer & Drag tracking for First-Person Look
    this.isDragging = false;
    this.dragPointerId = null;
    this.dragPointerType = null;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.dragDistance = 0;
    this.dragButton = 0;

    // Touch Joystick tracking
    this.joystickTouchId = null;
    this.joystickCenter = { x: 0, y: 0 };
    this.isTouchADS = false;

    // Callbacks
    this.onShoot = null;
    this.onADS = null;
    this.onInspect = null;
    this.onReload = null;
    this.onSlotSwitch = null;
    this.onQuickSwitch = null;
    this.onInteract = null;
    this.onMouseMove = null;
    this.onSlide = null;
    this.onReturnLobby = null;

    this.initEvents();
    this.initMobileControls();
  }

  requestPointerLock() {
    if (!this.domElement) return;
    try {
      const p = this.domElement.requestPointerLock ? this.domElement.requestPointerLock() : null;
      if (p && p.catch) p.catch(() => {});
    } catch (err) {}
  }

  // Starts the game: hides blocker and engages controls
  startGame() {
    this.isGameActive = true;
    const blocker = document.getElementById('blocker');
    if (blocker) blocker.style.display = 'none';

    // Show mobile controls if on touch device OR small viewport
    const isMobile = (window.innerWidth <= 768) || ('ontouchstart' in window);
    const mobControls = document.getElementById('mobile-controls');
    if (mobControls) {
      mobControls.style.display = isMobile ? 'block' : 'none';
    }

    // Immediately request pointer lock for standard FPS mouse look
    this.requestPointerLock();
  }

  initEvents() {
    // Start button & blocker click
    const playBtn = document.getElementById('play-btn');
    const blocker = document.getElementById('blocker');

    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startGame();
      });
      playBtn.addEventListener('touchend', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.startGame();
      });
    }

    if (blocker) {
      blocker.addEventListener('click', () => {
        this.startGame();
      });
    }

    // Pointer lock state listener
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = (document.pointerLockElement === this.domElement);
    });

    // Re-lock mouse on canvas/screen click when game is active
    window.addEventListener('click', (e) => {
      if (this.isGameActive && !this.isLocked) {
        if (!e.target.closest('#shop-modal, #map-modal, #settings-modal, .shop-window, #blocker')) {
          this.requestPointerLock();
        }
      }
    });

    // --- MOUSE MOVE (Pointer Lock mode) ---
    document.addEventListener('mousemove', (e) => {
      if (!this.isGameActive || !this.enabled) return;

      if (this.isLocked) {
        const dx = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
        const dy = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
        this.applyLookDelta(dx, dy, this.mouseSensitivity);
      }
    });

    // --- UNIFIED POINTER EVENTS (Drag to look on desktop without pointerlock, touchscreens & mobile) ---
    window.addEventListener('pointerdown', (e) => {
      if (!this.isGameActive || !this.enabled) return;

      // Ignore if clicking inside interactive menus or modals
      if (e.target && e.target.closest && e.target.closest('#shop-modal, #map-modal, #settings-modal, #blocker, .shop-window')) {
        return;
      }

      // Ignore if touching virtual joystick or mobile action buttons
      if (e.target && e.target.closest && e.target.closest('#joystick-zone, #mobile-action-buttons')) {
        return;
      }

      // Attempt pointer lock on primary mouse click if not locked yet
      if (e.pointerType === 'mouse' && !this.isLocked && e.button === 0) {
        this.requestPointerLock();
      }

      // Right click with mouse -> Aim Down Sights (ADS)
      if (e.button === 2 && this.onADS) {
        this.onADS(true);
      }

      this.isDragging = true;
      this.dragPointerId = e.pointerId;
      this.dragPointerType = e.pointerType;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.dragDistance = 0;
      this.dragButton = e.button;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isGameActive || !this.enabled) return;

      // If pointer locked, mousemove handles it directly with movementX/Y
      if (this.isLocked && e.pointerType === 'mouse') {
        return;
      }

      // If dragging with mouse or touch/pen on screen
      if (this.isDragging && (this.dragPointerId === e.pointerId || e.pointerType === 'mouse')) {
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.dragDistance += Math.hypot(dx, dy);

        const sens = (e.pointerType === 'touch') ? this.mouseSensitivity * 1.5 : this.mouseSensitivity;
        this.applyLookDelta(dx, dy, sens);
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (this.isDragging && (this.dragPointerId === e.pointerId || e.pointerType === 'mouse')) {
        this.isDragging = false;
        this.dragPointerId = null;

        // Disengage ADS on right click release
        if (e.button === 2 && this.onADS) {
          this.onADS(false);
        }

        // Left click with minimal drag (< 6px) triggers weapon shoot
        if (this.dragButton === 0 && this.dragDistance < 6 && this.onShoot) {
          this.onShoot();
        }
      }
    });

    window.addEventListener('pointercancel', (e) => {
      if (this.dragPointerId === e.pointerId) {
        this.isDragging = false;
        this.dragPointerId = null;
      }
    });

    // When pointer lock is active, handle direct mousedown/up for shooting and scoping
    window.addEventListener('mousedown', (e) => {
      if (!this.isGameActive || !this.isLocked) return;
      if (e.button === 0 && this.onShoot) {
        this.onShoot();
      } else if (e.button === 2 && this.onADS) {
        this.onADS(true);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isGameActive || !this.isLocked) return;
      if (e.button === 2 && this.onADS) {
        this.onADS(false);
      }
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // Mouse Wheel Weapon Swap
    window.addEventListener('wheel', (e) => {
      if (!this.isGameActive) return;
      if (this.onSlotSwitch) {
        if (e.deltaY < 0) {
          this.onSlotSwitch('SNIPER');
        } else if (e.deltaY > 0) {
          this.onSlotSwitch('KNIFE');
        }
      }
    }, { passive: true });

    // Click on weapon card to swap
    const weaponCard = document.querySelector('.weapon-card');
    if (weaponCard) {
      weaponCard.style.cursor = 'pointer';
      weaponCard.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onQuickSwitch) this.onQuickSwitch();
      });
    }

    // --- KEYBOARD INPUT ---
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  applyLookDelta(dx, dy, sens) {
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;

    // Clamp pitch to avoid screen flipping (-89 deg to +89 deg)
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));

    this.yawObject.rotation.y = this.yaw;
    this.pitchObject.rotation.x = this.pitch;

    if (this.onMouseMove) {
      this.onMouseMove(dx, dy);
    }
  }

  // --- MOBILE VIRTUAL JOYSTICK & TOUCH BUTTONS ---
  initMobileControls() {
    const joyZone = document.getElementById('joystick-zone');
    const joyKnob = document.getElementById('joystick-knob');
    if (!joyZone || !joyKnob) return;

    const maxRadius = 45;

    const handleJoyStart = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const touch = e.targetTouches[0];
      this.joystickTouchId = touch.identifier;

      const rect = joyZone.getBoundingClientRect();
      this.joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      updateJoy(touch.clientX, touch.clientY);
    };

    const handleJoyMove = (e) => {
      e.preventDefault();
      e.stopPropagation();
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === this.joystickTouchId) {
          updateJoy(e.touches[i].clientX, e.touches[i].clientY);
          break;
        }
      }
    };

    const handleJoyEnd = (e) => {
      e.preventDefault();
      this.joystickTouchId = null;
      this.joystickVector = { x: 0, y: 0 };
      joyKnob.style.transform = `translate(0px, 0px)`;
    };

    const updateJoy = (clientX, clientY) => {
      let dx = clientX - this.joystickCenter.x;
      let dy = clientY - this.joystickCenter.y;
      const dist = Math.hypot(dx, dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;

      // Normalized vector -1 to 1
      this.joystickVector.x = dx / maxRadius;
      this.joystickVector.y = dy / maxRadius;
    };

    joyZone.addEventListener('touchstart', handleJoyStart, { passive: false });
    joyZone.addEventListener('touchmove', handleJoyMove, { passive: false });
    joyZone.addEventListener('touchend', handleJoyEnd, { passive: false });
    joyZone.addEventListener('touchcancel', handleJoyEnd, { passive: false });

    // Touch Action Buttons (supports touch & mouse click)
    const bindTouchBtn = (id, onAction) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onAction();
      }, { passive: false });
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onAction();
      });
    };

    // Fire Button
    bindTouchBtn('m-btn-fire', () => {
      if (this.onShoot) this.onShoot();
    });

    // ADS Toggle Button
    bindTouchBtn('m-btn-ads', () => {
      this.isTouchADS = !this.isTouchADS;
      const btn = document.getElementById('m-btn-ads');
      if (btn) btn.classList.toggle('active', this.isTouchADS);
      if (this.onADS) this.onADS(this.isTouchADS);
    });

    // Jump Button
    bindTouchBtn('m-btn-jump', () => {
      if (this.canJump) {
        this.velocity.y = this.jumpForce;
        this.canJump = false;
      }
    });

    // Slide Button
    bindTouchBtn('m-btn-slide', () => {
      this.trySlide();
    });

    // Reload Button
    bindTouchBtn('m-btn-reload', () => {
      if (this.onReload) this.onReload();
    });

    // Weapon Swap Button
    bindTouchBtn('m-btn-switch', () => {
      if (this.onQuickSwitch) this.onQuickSwitch();
    });
  }

  onKeyDown(e) {
    if (!this.isGameActive) return;

    // Slot switching (checks both key and code for international layout support)
    if (e.key === '1' || e.code === 'Digit1' || e.code === 'Numpad1') {
      if (this.onSlotSwitch) this.onSlotSwitch('SNIPER');
      return;
    }
    if (e.key === '2' || e.code === 'Digit2' || e.code === 'Numpad2') {
      if (this.onSlotSwitch) this.onSlotSwitch('KNIFE');
      return;
    }
    if (e.key === 'q' || e.key === 'Q' || e.code === 'KeyQ') {
      if (this.onQuickSwitch) this.onQuickSwitch();
      return;
    }

    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.moveInput.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.moveInput.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.moveInput.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.moveInput.right = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.isSprinting = true;
        break;
      case 'Space':
        if (this.canJump) {
          this.velocity.y = this.jumpForce;
          this.canJump = false;
        }
        break;
      case 'KeyR':
        if (this.onReload) this.onReload();
        break;
      case 'KeyF':
        if (this.onInspect) this.onInspect();
        break;
      case 'KeyE':
        if (this.onInteract) this.onInteract();
        break;
      case 'KeyC':
      case 'ControlLeft':
        this.trySlide();
        break;
      case 'KeyL':
        if (this.onReturnLobby) this.onReturnLobby();
        break;
    }
  }

  trySlide() {
    const isMovingForward = this.moveInput.forward || (this.joystickVector.y < -0.3);
    if (this.canJump && !this.isSliding && isMovingForward) {
      this.isSliding = true;
      this.slideTimer = this.slideDuration;

      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.slideDir.copy(forward);

      const boostSpeed = this.baseSpeed * this.sprintMultiplier * 1.32;
      this.velocity.x = this.slideDir.x * boostSpeed;
      this.velocity.z = this.slideDir.z * boostSpeed;

      if (this.onSlide) this.onSlide();
    }
  }

  onKeyUp(e) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.moveInput.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.moveInput.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.moveInput.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.moveInput.right = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.isSprinting = false;
        break;
    }
  }

  teleport(pos, lookAtTarget = null) {
    this.yawObject.position.copy(pos);
    this.velocity.set(0, 0, 0);

    if (lookAtTarget) {
      const dir = lookAtTarget.clone().sub(pos);
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = 0;
      this.yawObject.rotation.y = this.yaw;
      this.pitchObject.rotation.x = this.pitch;
    }
  }

  getPosition() {
    return this.yawObject.position;
  }

  getShootRay() {
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    return { origin, direction: forward.normalize() };
  }

  update(delta, speedModifier = 1.0) {
    if (!this.enabled || !this.isGameActive) return;

    // 0. Update Slide State & Smooth Camera Eye Height
    if (this.isSliding) {
      this.slideTimer -= delta;
      if (this.slideTimer <= 0) {
        this.isSliding = false;
      }
    }
    const targetHeight = this.isSliding ? this.slideEyeHeight : this.normalEyeHeight;
    this.currentEyeHeight = THREE.MathUtils.damp(this.currentEyeHeight, targetHeight, 14.0, delta);
    this.pitchObject.position.y = this.currentEyeHeight;

    const targetRoll = this.isSliding ? -0.05 : 0.0;
    this.pitchObject.rotation.z = THREE.MathUtils.damp(this.pitchObject.rotation.z, targetRoll, 10.0, delta);

    // 1. Calculate desired movement direction from Keyboard OR Touch Joystick
    const moveDir = new THREE.Vector3();

    // Keyboard
    if (this.moveInput.forward) moveDir.z -= 1;
    if (this.moveInput.backward) moveDir.z += 1;
    if (this.moveInput.left) moveDir.x -= 1;
    if (this.moveInput.right) moveDir.x += 1;

    // Joystick input
    if (Math.abs(this.joystickVector.x) > 0.1 || Math.abs(this.joystickVector.y) > 0.1) {
      moveDir.x = this.joystickVector.x;
      moveDir.z = this.joystickVector.y;
    }

    if (moveDir.lengthSq() > 1.0) moveDir.normalize();

    // Rotate input to face player's yaw
    moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    // Speed calculation
    let currentSpeed = this.baseSpeed;
    if (this.isSprinting) currentSpeed *= this.sprintMultiplier;
    currentSpeed *= speedModifier;

    // Acceleration on ground
    if (!this.isSliding && moveDir.lengthSq() > 0) {
      this.velocity.x += moveDir.x * currentSpeed * 12.0 * delta;
      this.velocity.z += moveDir.z * currentSpeed * 12.0 * delta;
    }

    // Friction
    const effectiveFriction = this.isSliding ? this.friction * 0.35 : this.friction;
    this.velocity.x -= this.velocity.x * effectiveFriction * delta;
    this.velocity.z -= this.velocity.z * effectiveFriction * delta;

    // Gravity
    this.velocity.y -= this.gravity * delta;

    // 2. Perform Movement & Collision Resolution
    const pos = this.yawObject.position;
    const deltaX = this.velocity.x * delta;
    const deltaZ = this.velocity.z * delta;
    const deltaY = this.velocity.y * delta;

    pos.x += deltaX;
    this.updatePlayerBox();
    if (this.checkHorizontalCollision()) {
      pos.x -= deltaX;
      this.velocity.x = 0;
    }

    pos.z += deltaZ;
    this.updatePlayerBox();
    if (this.checkHorizontalCollision()) {
      pos.z -= deltaZ;
      this.velocity.z = 0;
    }

    pos.y += deltaY;
    this.updatePlayerBox();

    // Ground check against map colliders
    let grounded = false;
    for (const collider of this.map.colliders) {
      if (this.playerBox.intersectsBox(collider.box)) {
        if (this.velocity.y < 0) {
          pos.y = collider.box.max.y;
          this.velocity.y = 0;
          this.canJump = true;
          grounded = true;
          this.updatePlayerBox();
        } else if (this.velocity.y > 0) {
          pos.y = collider.box.min.y - this.playerHeight;
          this.velocity.y = 0;
        }
      }
    }

    if (pos.y < 0.5) {
      pos.y = 0.5;
      this.velocity.y = 0;
      this.canJump = true;
      grounded = true;
    }

    if (!grounded && Math.abs(this.velocity.y) > 0.5) {
      this.canJump = false;
    }

    return {
      isMoving: moveDir.lengthSq() > 0.01,
      isSprinting: this.isSprinting && moveDir.lengthSq() > 0.01,
      velocityLength: Math.hypot(this.velocity.x, this.velocity.z)
    };
  }

  updatePlayerBox() {
    const pos = this.yawObject.position;
    this.playerBox.min.set(pos.x - this.playerRadius, pos.y, pos.z - this.playerRadius);
    this.playerBox.max.set(pos.x + this.playerRadius, pos.y + this.playerHeight, pos.z + this.playerRadius);
  }

  // Only checks walls and obstacles above feet step-height, never the floor beneath the player
  checkHorizontalCollision() {
    const stepHeight = 0.4;
    const testBox = this.playerBox.clone();
    testBox.min.y += stepHeight;

    for (const collider of this.map.colliders) {
      if (collider.box.max.y <= this.yawObject.position.y + stepHeight) continue;

      if (testBox.intersectsBox(collider.box)) {
        return true;
      }
    }
    return false;
  }

  checkCollision() {
    for (const collider of this.map.colliders) {
      if (this.playerBox.intersectsBox(collider.box)) {
        return true;
      }
    }
    return false;
  }
}
