import { ethers } from 'ethers';

/**
 * Simple ABI for the HashRegistry contract.
 */
export const HASH_REGISTRY_ABI = [
  "function recordHash(bytes32 _hash) public",
  "function recordHashes(bytes32[] _hashes) public",
  "function verifyHash(bytes32 _hash) public view returns (uint256)",
  "event HashRecorded(bytes32 indexed hash, address indexed recorder, uint256 timestamp)"
];

/**
 * Address for the HashRegistry contract on Polygon Amoy.
 */
export const HASH_REGISTRY_ADDRESS = "0x42f792ee15e998364f33f33db811f175d4535a2b";

/**
 * Polygon Amoy Testnet Configuration
 */
export const AMOY_CONFIG = {
  chainId: '0x13882', // 80002
  chainName: 'Polygon Amoy Testnet',
  nativeCurrency: {
    name: 'MATIC',
    symbol: 'MATIC',
    decimals: 18
  },
  rpcUrls: ['https://rpc-amoy.polygon.technology'],
  blockExplorerUrls: ['https://amoy.polygonscan.com/']
};

/**
 * Checks if the current network is Polygon Amoy and switches if not.
 */
export async function ensureAmoyNetwork(provider: any) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: AMOY_CONFIG.chainId }],
    });
  } catch (switchError: any) {
    // This error code indicates that the chain has not been added to MetaMask.
    if (switchError.code === 4902) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [AMOY_CONFIG],
        });
      } catch (addError) {
        throw new Error('Could not add Polygon Amoy network to MetaMask.');
      }
    } else {
      throw switchError;
    }
  }
}

/**
 * Sanitizes a hash string to ensure it has exactly one '0x' prefix.
 */
function sanitizeHash(hash: string): string {
  const cleanHash = hash.startsWith('0x') ? hash.slice(2) : hash;
  return '0x' + cleanHash;
}

/**
 * Records a hash on the blockchain.
 */
export async function recordHashOnChain(hash: string): Promise<string> {
  if (!window.ethereum) throw new Error('MetaMask is not installed.');

  const provider = new ethers.BrowserProvider(window.ethereum);
  await ensureAmoyNetwork(window.ethereum);
  
  // Check if the contract exists at the address
  const code = await provider.getCode(HASH_REGISTRY_ADDRESS);
  if (code === '0x' || code === '0x0') {
    throw new Error(`Contract not found at address ${HASH_REGISTRY_ADDRESS}. 
    
    IMPORTANT: If you deployed to "Remix VM" (JavaScript VM), it only exists in your browser tab. To use this app, you MUST deploy to "Injected Provider - MetaMask" on the Polygon Amoy network.`);
  }

  // Pre-check: Is it already recorded?
  // This prevents the "execution reverted" error during gas estimation
  const existingTimestamp = await verifyHashOnChain(hash);
  if (existingTimestamp) {
    throw new Error('This hash has already been recorded on the blockchain. You cannot record the same file twice.');
  }

  const signer = await provider.getSigner();
  const contract = new ethers.Contract(HASH_REGISTRY_ADDRESS, HASH_REGISTRY_ABI, signer);

  const bytes32Hash = sanitizeHash(hash);
  
  try {
    // Fetch current fee data from the network
    const feeData = await provider.getFeeData();
    
    // Polygon Amoy often requires a minimum gas price (e.g., 25 Gwei)
    // We'll use the network's suggested fees but ensure they meet a safe minimum
    const minGasPrice = ethers.parseUnits('30', 'gwei'); // 30 Gwei is usually safe for Amoy
    
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > minGasPrice 
      ? feeData.maxPriorityFeePerGas 
      : minGasPrice;
      
    const maxFeePerGas = feeData.maxFeePerGas && feeData.maxFeePerGas > maxPriorityFeePerGas
      ? feeData.maxFeePerGas 
      : maxPriorityFeePerGas * 2n;

    const tx = await contract.recordHash(bytes32Hash, {
      maxPriorityFeePerGas,
      maxFeePerGas
    });
    await tx.wait();
    return tx.hash;
  } catch (error: any) {
    console.error('Blockchain transaction error:', error);
    
    // Handle common revert reasons
    if (error.message?.includes('Hash already recorded')) {
      throw new Error('This hash has already been recorded on the blockchain.');
    }
    
    if (error.code === 'CALL_EXCEPTION') {
      throw new Error('The transaction failed. This often happens if the hash is already recorded or if you are using the wrong contract address.');
    }
    
    throw error;
  }
}

/**
 * Verifies if a hash is recorded on the blockchain.
 */
export async function verifyHashOnChain(hash: string): Promise<number | null> {
  try {
    // Use a public RPC for verification so no wallet is needed
    const provider = new ethers.JsonRpcProvider(AMOY_CONFIG.rpcUrls[0]);
    
    // Check if the contract exists at the address
    const code = await provider.getCode(HASH_REGISTRY_ADDRESS);
    if (code === '0x' || code === '0x0') {
      throw new Error(`Contract not found at address ${HASH_REGISTRY_ADDRESS}. 
      
      IMPORTANT: If you deployed to "Remix VM" (JavaScript VM), it only exists in your browser tab. To use this app, you MUST deploy to "Injected Provider - MetaMask" on the Polygon Amoy network.`);
    }

    const contract = new ethers.Contract(HASH_REGISTRY_ADDRESS, HASH_REGISTRY_ABI, provider);

    const bytes32Hash = sanitizeHash(hash);
    
    try {
      const timestamp = await contract.verifyHash(bytes32Hash);
      const ts = Number(timestamp);
      return ts > 0 ? ts : null;
    } catch (callError: any) {
      if (callError.code === 'CALL_EXCEPTION') {
        throw new Error('Contract call failed. This usually means the contract address is wrong or it was deployed on a different network.');
      }
      throw callError;
    }
  } catch (error: any) {
    console.error('Verification error:', error);
    
    // If it's already our custom error, just rethrow it
    if (error.message.includes('Contract not found') || error.message.includes('Contract call failed')) {
      throw error;
    }
    
    throw new Error(`Verification failed: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Records multiple hashes on the blockchain in a single transaction.
 * Note: Requires the contract to have a recordHashes(bytes32[]) function.
 */
export async function recordHashesOnChain(hashes: string[]): Promise<string> {
  if (!window.ethereum) throw new Error('MetaMask is not installed.');
  if (hashes.length === 0) throw new Error('No hashes to record.');

  const provider = new ethers.BrowserProvider(window.ethereum);
  await ensureAmoyNetwork(window.ethereum);
  
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(HASH_REGISTRY_ADDRESS, HASH_REGISTRY_ABI, signer);

  const bytes32Hashes = hashes.map(sanitizeHash);
  
  try {
    const feeData = await provider.getFeeData();
    const minGasPrice = ethers.parseUnits('30', 'gwei');
    
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > minGasPrice 
      ? feeData.maxPriorityFeePerGas 
      : minGasPrice;
      
    const maxFeePerGas = feeData.maxFeePerGas && feeData.maxFeePerGas > maxPriorityFeePerGas
      ? feeData.maxFeePerGas 
      : maxPriorityFeePerGas * 2n;

    const tx = await contract.recordHashes(bytes32Hashes, {
      maxPriorityFeePerGas,
      maxFeePerGas
    });
    await tx.wait();
    return tx.hash;
  } catch (error: any) {
    console.error('Batch blockchain transaction error:', error);
    
    if (error.message?.includes('unsupported fragment') || error.code === 'INVALID_ARGUMENT') {
      throw new Error('Your smart contract does not support batch recording. Please update your contract to include: function recordHashes(bytes32[] memory _hashes) public');
    }
    
    throw error;
  }
}
