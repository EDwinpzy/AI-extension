/*
 * Ten icon directions, all drawn on a 128x128 grid.
 *
 * Rules that make them survive a 16px toolbar slot:
 *   - one strong silhouette per icon, readable as a shape alone
 *   - no stroke thinner than 7 (a 16px render gets ~0.9px of it)
 *   - no detail that only exists above 48px
 * Every gradient id is namespaced per icon, since they share one page.
 */

const P = {
  cyan: '#2DD4FF',
  violet: '#8B5CF6',
  magenta: '#F472B6',
  ice: '#E8F4FF',
  deep: '#070B14',
};

/* Rounded-square plate with a corner glow, shared by every icon. */
function plate(id, tint) {
  return `
    <defs>
      <linearGradient id="${id}-bg" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="#131C33"/>
        <stop offset="0.55" stop-color="#0B1220"/>
        <stop offset="1" stop-color="#070A12"/>
      </linearGradient>
      <radialGradient id="${id}-glow" cx="0.28" cy="0.18" r="0.75">
        <stop offset="0" stop-color="${tint}" stop-opacity="0.42"/>
        <stop offset="0.55" stop-color="${tint}" stop-opacity="0.08"/>
        <stop offset="1" stop-color="${tint}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="128" height="128" rx="30" fill="url(#${id}-bg)"/>
    <rect width="128" height="128" rx="30" fill="url(#${id}-glow)"/>
    <rect x="0.75" y="0.75" width="126.5" height="126.5" rx="29.4"
          fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1.5"/>`;
}

function grad(id, name, stops, x2 = 1, y2 = 1) {
  return `<linearGradient id="${id}-${name}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops
    .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a === undefined ? 1 : a}"/>`)
    .join('')}</linearGradient>`;
}

const ICONS = [
  {
    id: '01-nodes',
    name: '神经节点',
    note: '三个外围节点连向核心，三角剪影在任何尺寸都立得住',
    svg(id) {
      return `${plate(id, P.cyan)}
      <defs>${grad(id, 'line', [['0', P.cyan], ['1', P.violet]])}
        ${grad(id, 'core', [['0', P.ice], ['1', P.cyan]])}
      </defs>
      <g stroke="url(#${id}-line)" stroke-width="7" stroke-linecap="round" fill="none">
        <path d="M64 64 L64 24"/>
        <path d="M64 64 L26 92"/>
        <path d="M64 64 L102 92"/>
        <path d="M64 24 L102 92"/>
      </g>
      <circle cx="64" cy="64" r="17" fill="url(#${id}-core)"/>
      <circle cx="64" cy="24" r="10" fill="${P.cyan}"/>
      <circle cx="26" cy="92" r="10" fill="${P.violet}"/>
      <circle cx="102" cy="92" r="10" fill="${P.cyan}"/>`;
    },
  },
  {
    id: '02-chip',
    name: '算力芯片',
    note: '六边形外壳 + 内方 + 六根引脚，最“硬件”的一组',
    svg(id) {
      return `${plate(id, P.violet)}
      <defs>${grad(id, 'hex', [['0', P.cyan], ['1', P.violet]])}</defs>
      <g stroke="url(#${id}-hex)" stroke-width="8" stroke-linecap="round">
        <path d="M64 16 L104 40 L104 88 L64 112 L24 88 L24 40 Z" fill="none"/>
        <path d="M64 16 L64 4"/>
        <path d="M104 40 L118 32"/>
        <path d="M104 88 L118 96"/>
        <path d="M64 112 L64 124"/>
        <path d="M24 88 L10 96"/>
        <path d="M24 40 L10 32"/>
      </g>
      <rect x="47" y="47" width="34" height="34" rx="8" fill="none"
            stroke="${P.ice}" stroke-opacity="0.92" stroke-width="7"/>`;
    },
  },
  {
    id: '03-prism',
    name: '棱镜分流',
    note: '一束光穿过三棱镜分成三色，直接对应“翻译/转换”语义',
    svg(id) {
      return `${plate(id, P.cyan)}
      <defs>${grad(id, 'tri', [['0', P.ice], ['1', P.cyan]])}</defs>
      <path d="M56 22 L104 100 L8 100 Z" fill="none" stroke="url(#${id}-tri)" stroke-width="8"
            stroke-linejoin="round"/>
      <g stroke-width="7" stroke-linecap="round">
        <path d="M62 58 L96 34" stroke="${P.magenta}"/>
        <path d="M64 62 L100 62" stroke="${P.cyan}"/>
        <path d="M62 66 L96 90" stroke="${P.violet}"/>
      </g>`;
    },
  },
  {
    id: '04-orbit',
    name: '原子轨道',
    note: '两条交叉轨道 + 实心核，圆形剪影，最稳的一组',
    svg(id) {
      return `${plate(id, P.violet)}
      <defs>${grad(id, 'ring', [['0', P.cyan], ['1', P.violet]])}</defs>
      <g fill="none" stroke="url(#${id}-ring)" stroke-width="7">
        <ellipse cx="64" cy="64" rx="50" ry="20" transform="rotate(-32 64 64)"/>
        <ellipse cx="64" cy="64" rx="50" ry="20" transform="rotate(32 64 64)"/>
      </g>
      <circle cx="64" cy="64" r="15" fill="${P.ice}"/>`;
    },
  },
  {
    id: '05-wave',
    name: '声波脉冲',
    note: '五根圆头竖条，噪声最少，16px 下依然干净',
    svg(id) {
      return `${plate(id, P.cyan)}
      <defs>${grad(id, 'bar', [['0', P.cyan], ['1', P.violet]], 1, 0)}</defs>
      <g fill="url(#${id}-bar)">
        <rect x="16" y="52" width="12" height="24" rx="6"/>
        <rect x="35" y="36" width="12" height="56" rx="6"/>
        <rect x="54" y="20" width="12" height="88" rx="6"/>
        <rect x="73" y="36" width="12" height="56" rx="6"/>
        <rect x="92" y="52" width="12" height="24" rx="6"/>
      </g>`;
    },
  },
  {
    id: '06-cube',
    name: '线框立方体',
    note: '等距立方体带内胆，几何感强，适合“结构/架构”',
    svg(id) {
      return `${plate(id, P.cyan)}
      <defs>${grad(id, 'edge', [['0', P.ice], ['1', P.cyan]])}</defs>
      <g fill="none" stroke="url(#${id}-edge)" stroke-width="7" stroke-linejoin="round">
        <path d="M64 12 L110 38 L110 90 L64 116 L18 90 L18 38 Z"/>
        <path d="M64 12 L64 64 L110 90"/>
        <path d="M64 64 L18 90"/>
        <path d="M64 64 L64 116"/>
      </g>`;
    },
  },
  {
    id: '07-brackets',
    name: '代码脉冲',
    note: '一对尖括号夹一个光点，开发者一眼认出',
    svg(id) {
      return `${plate(id, P.violet)}
      <defs>${grad(id, 'br', [['0', P.cyan], ['1', P.violet]])}</defs>
      <g fill="none" stroke="url(#${id}-br)" stroke-width="9" stroke-linecap="round"
         stroke-linejoin="round">
        <path d="M44 34 L18 64 L44 94"/>
        <path d="M84 34 L110 64 L84 94"/>
      </g>
      <circle cx="64" cy="64" r="12" fill="${P.ice}"/>`;
    },
  },
  {
    id: '08-radar',
    name: '雷达扫描',
    note: '三层同心环 + 扫描扇区，强调“感知/检索”',
    svg(id) {
      return `${plate(id, P.cyan)}
      <defs>
        ${grad(id, 'arc', [['0', P.cyan], ['1', P.violet]])}
        <linearGradient id="${id}-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${P.cyan}" stop-opacity="0.55"/>
          <stop offset="1" stop-color="${P.cyan}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M64 64 L64 14 A50 50 0 0 1 106 39 Z" fill="url(#${id}-sweep)"/>
      <g fill="none" stroke="url(#${id}-arc)" stroke-width="7">
        <circle cx="64" cy="64" r="50"/>
        <circle cx="64" cy="64" r="31"/>
        <circle cx="64" cy="64" r="13"/>
      </g>
      <circle cx="64" cy="64" r="7" fill="${P.ice}"/>`;
    },
  },
  {
    id: '09-layers',
    name: '层叠面板',
    note: '三层错位描边逐级收紧，最后一张实心，边界清楚不糊',
    svg(id) {
      return `${plate(id, P.violet)}
      <defs>${grad(id, 'card', [['0', P.cyan], ['1', P.violet]])}</defs>
      <rect x="18" y="18" width="60" height="60" rx="15" fill="none"
            stroke="${P.violet}" stroke-opacity="0.45" stroke-width="6"/>
      <rect x="34" y="34" width="60" height="60" rx="15" fill="none"
            stroke="${P.cyan}" stroke-opacity="0.7" stroke-width="6"/>
      <rect x="50" y="50" width="60" height="60" rx="15" fill="url(#${id}-card)"/>`;
    },
  },
  {
    id: '10-mark',
    name: '电路 A 标',
    note: '用电路走线写成字母 A，最有品牌记忆点',
    svg(id) {
      return `${plate(id, P.cyan)}
      <defs>${grad(id, 'trace', [['0', P.cyan], ['1', P.violet]])}</defs>
      <g fill="none" stroke="url(#${id}-trace)" stroke-width="9" stroke-linecap="round"
         stroke-linejoin="round">
        <path d="M28 100 L64 22 L100 100"/>
        <path d="M46 76 L82 76"/>
      </g>
      <circle cx="64" cy="22" r="8" fill="${P.ice}"/>
      <circle cx="28" cy="100" r="8" fill="${P.ice}"/>
      <circle cx="100" cy="100" r="8" fill="${P.ice}"/>`;
    },
  },
];

/* The page and the rasterizer both read this. */
window.ICONS = ICONS;
window.iconSvg = (icon, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">${icon.svg(icon.id)}</svg>`;
