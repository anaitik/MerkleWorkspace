import { hashPair } from './hash';

/**
 * Calculates the Merkle Root for a given array of leaf hashes.
 * If the number of nodes at a level is odd, the last node is duplicated.
 */
export async function calculateMerkleRoot(leaves: string[]): Promise<string | null> {
  if (leaves.length === 0) return null;
  
  let currentLevel = [...leaves];
  
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(await hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        // Duplicate the last node if odd number of nodes
        nextLevel.push(await hashPair(currentLevel[i], currentLevel[i]));
      }
    }
    currentLevel = nextLevel;
  }
  
  return currentLevel[0];
}

const STORAGE_KEY = 'merkle_leaves';

/**
 * Retrieves the list of leaf hashes stored in localStorage.
 */
export function getStoredLeaves(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to parse stored Merkle leaves:', error);
    return [];
  }
}

/**
 * Saves the list of leaf hashes to localStorage.
 */
export function saveLeaves(leaves: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(leaves));
  } catch (error) {
    console.error('Failed to save Merkle leaves:', error);
  }
}

/**
 * Clears the stored Merkle leaves.
 */
export function clearStoredLeaves() {
  localStorage.removeItem(STORAGE_KEY);
}
