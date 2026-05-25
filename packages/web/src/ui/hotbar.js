// Single "pick ten" hotbar. Slots are bound by (barIdx, slotIdx) to keep the
// old save/API shape stable, but only bar 0 is rendered or keyboard-addressable.

import { TOOLS_BY_ID } from './tools-table.js';
import { ICONS } from './icons.js';
import { getMasterMul } from '../progression/master-mults.js';
import {
  getEquippedBar, isToolUnlocked, unequipTool,
  equipToolInSlot,
  onChange as onProgressionChange,
  HOTBAR_SLOTS,
} from '../progression/state.js';
import { openSlotPicker, openPicker } from './slot-picker.js';

let activeTool = 'grab';
const toolListeners = [];
const cooldownUntil = {}; // toolId -> timestamp

export function getActiveTool() { return activeTool; }
export function getActiveToolKind() { return TOOLS_BY_ID[activeTool]?.kind || 'click'; }
export function onToolChange(fn) { toolListeners.push(fn); }

// Resolve the tool bound to a (barIdx, slotIdx).
export function getToolForBarSlot(barIdx, slotIdx) {
  if (barIdx !== 0) return null;
  if (slotIdx < 0 || slotIdx >= HOTBAR_SLOTS) return null;
  return getEquippedBar(barIdx)[slotIdx] ?? null;
}

export function setActiveTool(t) {
  if (cooldownUntil[t] && performance.now() < cooldownUntil[t]) return;
  const def = TOOLS_BY_ID[t];
  if (!def) return;
  // Unowned tools can't be activated, open the shop pre-inspecting the
  // locked tool so the player sees its unlock cost immediately.
  if (!isToolUnlocked(t)) {
    openPicker({ toolId: t });
    return;
  }
  activeTool = t;
  document.querySelectorAll('.slot').forEach(el => el.classList.toggle('active', el.dataset.tool === t));
  const kind = def.kind || 'click';
  document.body.style.cursor = kind === 'drag' ? 'grab' : (kind === 'hold' ? 'cell' : 'crosshair');
  toolListeners.forEach(fn => fn(t));
}

// Activate the tool currently bound to a (barIdx, slotIdx). Used by keyboard.
export function setActiveToolByBarSlot(barIdx, slotIdx) {
  const id = getToolForBarSlot(barIdx, slotIdx);
  if (id) setActiveTool(id);
}

let _root = null;

export function bindHotbar(rootEl) {
  _root = rootEl ?? document.getElementById('hotbar');
  if (!_root) return;
  buildHotbar();
  if (!isToolUnlocked(activeTool)) activeTool = 'grab';
  setActiveTool(activeTool);
  onProgressionChange(() => {
    buildHotbar();
    if (!isToolUnlocked(activeTool)) activeTool = 'grab';
    setActiveTool(activeTool);
  });
}

// Slot 0-8 → keys 1-9; slot 9 → key "0".
const SLOT_KEY_LABELS = ['1','2','3','4','5','6','7','8','9','0'];

function buildHotbar() {
  if (!_root) return;
  _root.innerHTML = '';

  // Bar 0 is the always-inline primary action bar.
  _root.appendChild(buildBar(0));
}

function buildBar(barIdx) {
  const row = document.createElement('div');
  row.className = 'hotbar-row';
  row.dataset.bar = String(barIdx);
  const equipped = getEquippedBar(barIdx);
  for (let s = 0; s < HOTBAR_SLOTS; s++) {
    // System tools (grab) live in fixed slots outside the hotbar, never
    // render them in a hotbar cell, even if a pre-migration save still has
    // them in equippedBars. The v7→v8 migration scrubs these too, but this
    // guard makes the rendering layer correct on its own.
    const id = equipped[s] ?? null;
    const renderId = id && TOOLS_BY_ID[id]?.system ? null : id;
    row.appendChild(buildSlot(barIdx, s, renderId));
  }
  return row;
}

function buildSlot(barIdx, slotIdx, toolId) {
  const btn = document.createElement('button');
  btn.className = 'slot';
  btn.dataset.bar = String(barIdx);
  btn.dataset.slot = String(slotIdx);
  const keyLabel = SLOT_KEY_LABELS[slotIdx] || '';

  if (!toolId) {
    btn.classList.add('empty');
    btn.dataset.tooltip = `${keyLabel || 'empty slot'} · click to equip`;
    // Empties render as quiet spacers, the "+" only surfaces on hover so
    // revealed bars don't shout a wall of placeholders.
    btn.innerHTML = `<span class="slot-plus">+</span>`;
    btn.addEventListener('click', () => openSlotPicker(barIdx, slotIdx, btn));
    attachDropTarget(btn, barIdx, slotIdx);
    return btn;
  }

  const t = TOOLS_BY_ID[toolId];
  if (!t) {
    btn.classList.add('empty');
    btn.innerHTML = `<span class="slot-key">${keyLabel}</span><span class="slot-plus">+</span>`;
    return btn;
  }
  btn.dataset.tool = t.id;
  btn.dataset.spine = t.spine;
  btn.dataset.group = t.group;
  if (t.cd) btn.dataset.cd = t.cd;
  btn.dataset.tooltip = `${t.label} · ${t.blurb}${t.delta ? ' · ' + t.delta : ''}`;

  // Icon-only rendering, FF14-style. The hotkey badge stays in the corner;
  // the icon fills the slot. Tool labels live in the tooltip and the shop.
  const icon = ICONS[t.id];
  const iconSvg = icon
    ? `<svg viewBox="-16 -16 32 32" class="slot-icon" aria-hidden="true">
         <path d="${icon.d}" class="${icon.fill ? 'icon-fill' : 'icon-stroke'}"/>
       </svg>`
    : `<span class="slot-glyph">${(t.label || '?').slice(0, 2)}</span>`;

  btn.innerHTML = `
    <span class="slot-key">${keyLabel}</span>
    ${iconSvg}
    <span class="slot-cd-overlay" aria-hidden="true"></span>
    <button class="slot-swap" type="button" tabindex="-1" aria-label="swap tool in this slot" title="swap this slot">⇄</button>
  `;
  btn.addEventListener('click', (e) => {
    // Click on the swap chip → open picker anchored to this slot (don't
    // activate the tool).
    if (e.target instanceof HTMLElement && e.target.closest('.slot-swap')) {
      e.stopPropagation();
      openSlotPicker(barIdx, slotIdx, btn);
      return;
    }
    // Shift-click → also opens the picker (legacy power-user shortcut).
    if (e.shiftKey) { openSlotPicker(barIdx, slotIdx, btn); return; }
    setActiveTool(t.id);
  });
  // Right-click → open the picker anchored to this slot so the player can
  // pick a replacement directly. This is the "I want to change what's here"
  // gesture. Inspect of the equipped tool is still reachable: open the
  // picker, the equipped tile is highlighted, right-click it for inspect.
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openSlotPicker(barIdx, slotIdx, btn);
  });
  attachDragSource(btn, barIdx, slotIdx, t.id);
  attachDropTarget(btn, barIdx, slotIdx);
  return btn;
}

// ---------- drag-and-drop ----------
//
// Filled slots are drag sources; every slot (filled or empty) is a drop
// target. Drop calls equipToolInSlot which de-dupes the dragged tool from
// any other slot before placing it, that's exactly the swap semantics we
// want. Drop on a filled destination kicks the previous tool back into
// the dragged source's slot so swap is symmetric.
//
// dragend that lands outside any slot unequips the tool (drag-off-bar to
// remove). We track this via a module-private flag set on successful drop.

let _dropHandled = false;

function attachDragSource(btn, barIdx, slotIdx, toolId) {
  btn.draggable = true;
  btn.addEventListener('dragstart', (e) => {
    _dropHandled = false;
    btn.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Payload is informational, the live state lives on _drag below.
      try { e.dataTransfer.setData('text/plain', `${barIdx}:${slotIdx}:${toolId}`); } catch {}
    }
    _drag = { barIdx, slotIdx, toolId };
  });
  btn.addEventListener('dragend', () => {
    btn.classList.remove('dragging');
    document.querySelectorAll('.slot.drop-target').forEach(el => el.classList.remove('drop-target'));
    if (!_dropHandled && _drag) {
      // Dropped outside any slot, interpret as "remove from bar".
      unequipTool(_drag.toolId);
    }
    _drag = null;
  });
}

let _drag = null;

function attachDropTarget(btn, barIdx, slotIdx) {
  btn.addEventListener('dragover', (e) => {
    if (!_drag) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    btn.classList.add('drop-target');
  });
  btn.addEventListener('dragleave', () => btn.classList.remove('drop-target'));
  btn.addEventListener('drop', (e) => {
    if (!_drag) return;
    e.preventDefault();
    btn.classList.remove('drop-target');
    _dropHandled = true;
    const src = _drag;
    if (src.barIdx === barIdx && src.slotIdx === slotIdx) return;

    // Swap: read the destination's current occupant before equipToolInSlot
    // de-dupes the dragged tool from there. If dest had a tool, place it
    // back in the source slot.
    const destTool = getEquippedBar(barIdx)[slotIdx] ?? null;
    equipToolInSlot(src.toolId, barIdx, slotIdx);
    if (destTool && destTool !== src.toolId) {
      equipToolInSlot(destTool, src.barIdx, src.slotIdx);
    }
  });
}

// Triggered by ability handlers when a god-power tool fires. Phase 6:
// the master-tree archetype STATS.master.cooldownMul / cataclysmCdMul
// scale the on-disk cooldown, The Whale gets +60% generally but halves
// cataclysm cooldowns specifically. Defaults to 1× when no archetype is
// owned.
export function startCooldown(id) {
  const t = TOOLS_BY_ID[id];
  if (!t || !t.cd) return;
  const baseMul = getMasterMul('cooldownMul') || 1;
  const groupMul = t.group === 'cataclysm' ? (getMasterMul('cataclysmCdMul') || 1) : 1;
  const seconds = t.cd * baseMul * groupMul;
  cooldownUntil[id] = performance.now() + seconds * 1000;
  // Mark every slot bound to this tool (could be multiple bars, but we
  // de-dupe on equip, so usually only one).
  document.querySelectorAll(`.slot[data-tool="${id}"]`).forEach(btn => {
    btn.classList.add('on-cooldown');
    btn.style.setProperty('--cd-time', `${seconds}s`);
    setTimeout(() => {
      btn.classList.remove('on-cooldown');
      btn.style.removeProperty('--cd-time');
    }, seconds * 1000);
  });
}
