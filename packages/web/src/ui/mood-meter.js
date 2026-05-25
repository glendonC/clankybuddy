// Mood plumbing, formerly drove the persistent boss-nameplate bar.
// The bar was removed when the nameplate became a pure-aesthetic transient
// (Track 2). This module stays alive only to keep the dev-panel + reactions
// hook IDs (#mood-label, #stat-pets, #stat-hits) populated. Track 1 will
// give mood a real home; until then this is a no-render shim.

import { moodState } from '../mood.js';

export function updateMoodUI(mood) {
  const moodLabel = document.getElementById('mood-label');
  if (moodLabel) moodLabel.textContent = moodState(mood).name.toLowerCase();
  const pets = document.getElementById('stat-pets');
  const hits = document.getElementById('stat-hits');
  if (pets) pets.textContent = mood.pets;
  if (hits) hits.textContent = mood.hits;
}
