/**
 * @module store-screen
 * In-game cosmetic store UI (#33).
 * Renders category tabs, items, purchase flow.
 */

import { getCoins, getCosmeticsByCategory, purchaseCosmetic, equipCosmetic, getEquipped, CATEGORIES } from '../game/cosmetics.js';
import { getBattlePassState, claimFreeReward, claimPremiumReward } from '../game/battle-pass.js';
import { getColor } from '../config/palettes.js';

// ─── DOM refs ────────────────────────────────────────────────
let $storeScreen = null;
let $storeList   = null;
let $storeCoins  = null;
let $storeTabs   = null;
let activeCategory = 'trail';

const CAT_LABELS = {
  trail:       '💫 Trails',
  deathEffect: '💥 Death FX',
  bulletSkin:  '🔫 Bullets',
  shield:      '🛡 Shield',
  aura:        '✨ Aura',
  title:       '🏷 Title',
  banner:      '🎌 Banner',
  emote:       '😎 Emote',
  music:       '🎵 Music',
  announcer:   '📢 Announcer',
};

export function initStoreScreen() {
  $storeScreen = document.getElementById('store-screen');
  if (!$storeScreen) return;
  $storeList  = document.getElementById('store-list');
  $storeCoins = document.getElementById('store-coins');
  $storeTabs  = document.getElementById('store-tabs');

  // Build category tabs
  if ($storeTabs) {
    $storeTabs.innerHTML = Object.entries(CAT_LABELS).map(([key, label]) =>
      `<button class="store-tab${key === activeCategory ? ' active' : ''}" data-cat="${key}">${label}</button>`
    ).join('');
    $storeTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.store-tab');
      if (!btn) return;
      activeCategory = btn.dataset.cat;
      $storeTabs.querySelectorAll('.store-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderStoreItems();
    });
  }
}

export function showStoreScreen() {
  renderStoreItems();
  if ($storeScreen) $storeScreen.classList.add('active');
}

export function hideStoreScreen() {
  if ($storeScreen) $storeScreen.classList.remove('active');
}

function renderStoreItems() {
  if (!$storeList) return;
  const coins = getCoins();
  if ($storeCoins) $storeCoins.textContent = `💰 ${coins}`;

  const items = getCosmeticsByCategory(activeCategory);
  const equipped = getEquipped(activeCategory);

  $storeList.innerHTML = items.map(item => {
    const isEquipped = equipped === item.id;
    const isOwned = item.owned;
    const canAfford = coins >= item.price;
    const rarityClass = `rarity-${item.rarity}`;

    return `
      <div class="store-item ${rarityClass} ${isEquipped ? 'equipped' : ''}" data-id="${item.id}">
        <div class="store-item-name">${item.name}</div>
        <div class="store-item-rarity">${item.rarity}</div>
        ${isOwned
          ? `<button class="btn-store ${isEquipped ? 'btn-equipped' : 'btn-equip'}" data-action="${isEquipped ? 'unequip' : 'equip'}" data-id="${item.id}">
              ${isEquipped ? '✓ EQUIPPED' : 'EQUIP'}
            </button>`
          : `<button class="btn-store btn-buy ${canAfford ? '' : 'btn-disabled'}" data-action="buy" data-id="${item.id}" ${canAfford ? '' : 'disabled'}>
              💰 ${item.price}
            </button>`
        }
      </div>
    `;
  }).join('') || '<div class="store-empty">No items in this category</div>';

  // Wire click handlers
  $storeList.querySelectorAll('.btn-store').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'buy') {
        purchaseCosmetic(id);
      } else if (action === 'equip') {
        equipCosmetic(id);
      }
      renderStoreItems();
    });
  });
}

export default { initStoreScreen, showStoreScreen, hideStoreScreen };
