/**
 * 🎊 Candidatic Confetti Engine — Zero Dependencies
 * Lightweight canvas-based confetti burst for new candidate celebrations.
 */

const COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
  '#ec4899', '#06b6d4', '#f97316', '#8b5cf6', '#14b8a6'
];

let _canvas = null;
let _ctx = null;
let _particles = [];
let _animId = null;

function ensureCanvas() {
  if (_canvas) return;
  _canvas = document.createElement('canvas');
  _canvas.id = 'confetti-canvas';
  Object.assign(_canvas.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '99999',
  });
  document.body.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!_canvas) return;
  _canvas.width = window.innerWidth;
  _canvas.height = window.innerHeight;
}

class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 16;
    this.vy = -(Math.random() * 14 + 6);
    this.gravity = 0.35;
    this.drag = 0.98;
    this.rotation = Math.random() * 360;
    this.rotSpeed = (Math.random() - 0.5) * 12;
    this.w = Math.random() * 8 + 4;
    this.h = Math.random() * 4 + 2;
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    this.opacity = 1;
    this.life = 1;
    this.decay = 0.008 + Math.random() * 0.006;
  }

  update() {
    this.vy += this.gravity;
    this.vx *= this.drag;
    this.x += this.vx;
    this.y += this.vy;
    this.rotation += this.rotSpeed;
    this.life -= this.decay;
    this.opacity = Math.max(0, this.life);
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.globalAlpha = this.opacity;
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }
}

function animate() {
  if (!_ctx || _particles.length === 0) {
    _ctx?.clearRect(0, 0, _canvas.width, _canvas.height);
    _animId = null;
    return;
  }

  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

  _particles = _particles.filter(p => p.life > 0);
  _particles.forEach(p => {
    p.update();
    p.draw(_ctx);
  });

  _animId = requestAnimationFrame(animate);
}

/**
 * Fire confetti burst!
 * @param {number} count - Number of particles (default 80)
 * @param {HTMLElement|null} originEl - Optional element to burst from
 */
export function fireConfetti(count = 80, originEl = null) {
  ensureCanvas();

  let cx, cy;
  if (originEl) {
    // Burst from the element's center position
    const rect = originEl.getBoundingClientRect();
    cx = rect.left + rect.width / 2;
    cy = rect.top + rect.height / 2;
  } else {
    cx = _canvas.width / 2;
    cy = _canvas.height * 0.25;
  }

  for (let i = 0; i < count; i++) {
    _particles.push(new Particle(
      cx + (Math.random() - 0.5) * 160,
      cy + (Math.random() - 0.5) * 30
    ));
  }

  if (!_animId) {
    _animId = requestAnimationFrame(animate);
  }
}
